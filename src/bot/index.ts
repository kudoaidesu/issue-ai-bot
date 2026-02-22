import {
  Client,
  Collection,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  type ChatInputCommandInteraction,
} from 'discord.js'
import { config } from '../config.js'
import { createLogger } from '../utils/logger.js'
import { initNotifier } from './notifier.js'
import { handleMessage } from './events/messageCreate.js'

// コマンドのインポート
import * as issueCmd from './commands/issue.js'
import * as statusCmd from './commands/status.js'
import * as queueCmd from './commands/queue.js'
import * as runCmd from './commands/run.js'
import * as cronCmd from './commands/cron.js'
import * as costCmd from './commands/cost.js'

const log = createLogger('bot')

interface Command {
  data: { name: string; toJSON: () => unknown }
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>
}

const commands = new Collection<string, Command>()
const commandList: Command[] = [issueCmd, statusCmd, queueCmd, runCmd, cronCmd, costCmd]

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
  })

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return

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
  })

  client.on(Events.MessageCreate, (message) => {
    void handleMessage(message)
  })

  await client.login(config.discord.botToken)

  return client
}
