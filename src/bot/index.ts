import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { initNotifier } from './notifier.js'
import { expireStaleSessions, cleanupArchived } from '../session/index.js'
import { handleMessage } from './events/messageCreate.js'
import { handleGuildChat } from './events/guildChat.js'
import { handleButtonInteraction } from './events/buttonHandler.js'
import { handleSelectMenuInteraction } from './events/selectMenuHandler.js'
import { checkModelListFreshness } from './chat-model.js'

// コマンドのインポート
import * as issueCmd from './commands/issue.js'
import * as statusCmd from './commands/status.js'
import * as queueCmd from './commands/queue.js'
import * as runCmd from './commands/run.js'
import * as cronCmd from './commands/cron.js'
import * as usageCmd from './commands/usage.js'
import * as modelCmd from './commands/model.js'
import * as askCmd from './commands/ask.js'
import * as sessionCmd from './commands/session.js'

const log = createLogger('bot')

interface Command {
  data: { name: string; toJSON: () => unknown }
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>
}

const commands = new Collection<string, Command>()
const commandList: Command[] = [issueCmd, statusCmd, queueCmd, runCmd, cronCmd, usageCmd, modelCmd, askCmd, sessionCmd]

for (const cmd of commandList) {
  commands.set(cmd.data.name, cmd)
}

export async function startBot(): Promise<Client> {
  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
  })

  const rest = new REST({ version: '10' }).setToken(config.discord.botToken)
  const commandData = commandList.map((cmd) => cmd.data.toJSON())

  // イベントハンドラ
  client.once(Events.ClientReady, (readyClient) => {
    log.info(`Bot ready: ${readyClient.user.tag}`)

    // スラッシュコマンド登録（全プロジェクトのguildIdに対して）
    const appId = readyClient.application.id
    const registrations = config.projects
      .filter((p) => p.guildId)
      .map((p) =>
        rest
          .put(Routes.applicationGuildCommands(appId, p.guildId), { body: commandData })
          .then(() => log.info(`Registered ${commandData.length} commands for guild ${p.slug}`)),
      )
    void Promise.all(registrations)

    initNotifier(client)
    checkModelListFreshness()

    // セッションクリーンアップ: 起動時 + 1時間ごと
    expireStaleSessions()
    cleanupArchived()
    setInterval(() => {
      expireStaleSessions()
      cleanupArchived()
    }, 60 * 60 * 1000)
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    // オートコンプリート
    if (interaction.isAutocomplete()) {
      const command = commands.get(interaction.commandName)
      if (command?.autocomplete) {
        try {
          await command.autocomplete(interaction)
        } catch (err) {
          log.error(`Autocomplete ${interaction.commandName} failed`, err)
        }
      }
      return
    }

    // スラッシュコマンド
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName)
      if (!command) return

      try {
        await command.execute(interaction)
      } catch (err) {
        log.error(`Command ${interaction.commandName} failed`, err)
        const reply = {
          content: 'コマンドの実行中にエラーが発生しました。',
          ephemeral: true,
        }
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(reply)
        } else {
          await interaction.reply(reply)
        }
      }
      return
    }

    // ボタン
    if (interaction.isButton()) {
      try {
        await handleButtonInteraction(interaction)
      } catch (err) {
        log.error('Button interaction failed', err)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: 'ボタン処理中にエラーが発生しました。', ephemeral: true })
        }
      }
      return
    }

    // セレクトメニュー
    if (interaction.isStringSelectMenu()) {
      try {
        await handleSelectMenuInteraction(interaction)
      } catch (err) {
        log.error('Select menu interaction failed', err)
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({ content: '選択メニュー処理中にエラーが発生しました。', ephemeral: true })
        }
      }
      return
    }
  })

  client.on(Events.MessageCreate, (message) => {
    if (message.guild) {
      void handleGuildChat(message)
    } else {
      void handleMessage(message)
    }
  })

  await client.login(config.discord.botToken)

  return client
}
