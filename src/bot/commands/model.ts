import {
  type ChatInputCommandInteraction,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  ActionRowBuilder,
} from 'discord.js'
import { MODEL_OPTIONS, MODEL_OPTIONS_UPDATED } from '../../config.js'
import {
  setRuntimeModel,
  clearRuntimeModel,
  getModelInfo,
  getModelDisplayName,
  fetchAvailableModels,
} from '../chat-model.js'
import { COLORS, createEmbed } from '../theme.js'

const SOURCE_LABELS: Record<string, string> = {
  runtime: '/model（ランタイム）',
  project: 'projects.json（プロジェクト設定）',
  env: 'CHAT_MODEL 環境変数',
  default: 'デフォルト',
}

/** セレクトメニューの customId */
export const MODEL_SELECT_ID = 'model_select'

export const data = new SlashCommandBuilder()
  .setName('model')
  .setDescription('チャットのLLMモデルを管理')
  .addSubcommand((sub) =>
    sub
      .setName('show')
      .setDescription('現在のモデル設定を表示し、変更用セレクトメニューを表示'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('custom')
      .setDescription('カスタムモデルIDを直接指定')
      .addStringOption((opt) =>
        opt
          .setName('model_id')
          .setDescription('Claude CLIのモデルID（例: claude-sonnet-4-5-20250514）')
          .setRequired(true),
      ),
  )
  .addSubcommand((sub) =>
    sub
      .setName('reset')
      .setDescription('ランタイム設定をクリアしてデフォルトに戻す'),
  )
  .addSubcommand((sub) =>
    sub
      .setName('sync')
      .setDescription('Anthropic APIから最新のモデル一覧を取得して表示')
      .addStringOption((opt) =>
        opt
          .setName('api_key')
          .setDescription('Anthropic API Key（一時的に使用、保存されません）')
          .setRequired(true),
      ),
  )

export async function execute(
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const guildId = interaction.guildId
  if (!guildId) {
    await interaction.reply({ content: 'このコマンドはサーバー内でのみ使用できます。', ephemeral: true })
    return
  }

  const subcommand = interaction.options.getSubcommand()

  switch (subcommand) {
    case 'show': {
      const info = getModelInfo(guildId)

      const embed = createEmbed(COLORS.info, 'チャットモデル設定', {
        fields: [
          { name: '現在のモデル', value: `**${getModelDisplayName(info.resolved)}**`, inline: true },
          { name: 'ソース', value: SOURCE_LABELS[info.source] ?? info.source, inline: true },
          { name: '優先順位', value: [
            `1. \`--model <id>\` プレフィックス（メッセージごと）`,
            `2. /model: ${info.runtime ? getModelDisplayName(info.runtime) : '未設定'}`,
            `3. projects.json: ${info.project ?? '未設定'}`,
            `4. CHAT_MODEL 環境変数: ${info.env}`,
          ].join('\n') },
        ],
        footer: '下のメニューからモデルを選択して変更できます',
      })

      // OpenClaw風セレクトメニュー
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(MODEL_SELECT_ID)
        .setPlaceholder('モデルを選択...')
        .addOptions(
          MODEL_OPTIONS.map((opt) => ({
            label: opt.label,
            description: opt.description,
            value: opt.id,
            default: opt.id === info.resolved,
          })),
        )

      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)

      await interaction.reply({ embeds: [embed], components: [row] })
      break
    }

    case 'custom': {
      const modelId = interaction.options.getString('model_id', true)
      setRuntimeModel(guildId, modelId)

      const embed = createEmbed(COLORS.success, 'カスタムモデルを設定', {
        description: `モデルを **${modelId}** に設定しました。\nBot再起動でリセットされます。`,
      })

      await interaction.reply({ embeds: [embed] })
      break
    }

    case 'reset': {
      clearRuntimeModel(guildId)
      const info = getModelInfo(guildId)

      const embed = createEmbed(COLORS.success, 'モデル設定をリセット', {
        description: `ランタイム設定をクリアしました。\n現在のモデル: **${getModelDisplayName(info.resolved)}** (${SOURCE_LABELS[info.source] ?? info.source})`,
      })

      await interaction.reply({ embeds: [embed] })
      break
    }

    case 'sync': {
      const apiKey = interaction.options.getString('api_key', true)

      await interaction.deferReply({ ephemeral: true })

      try {
        const models = await fetchAvailableModels(apiKey)

        const currentIds = new Set(MODEL_OPTIONS.map((o) => o.id))
        const newModels = models.filter((m) => !currentIds.has(m.id))

        const modelList = models
          .slice(0, 15)
          .map((m) => {
            const isNew = !currentIds.has(m.id)
            return `${isNew ? '**[NEW]** ' : ''}${m.label} (\`${m.id}\`)`
          })
          .join('\n')

        const embed = createEmbed(
          newModels.length > 0 ? COLORS.warning : COLORS.success,
          'Anthropic モデル一覧',
          {
            description: modelList,
            footer: newModels.length > 0
              ? `${newModels.length} 件の未登録モデルがあります。config.ts の MODEL_OPTIONS を更新してください。`
              : `全モデル登録済み（最終更新: ${MODEL_OPTIONS_UPDATED}）`,
          },
        )

        await interaction.editReply({ embeds: [embed] })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        await interaction.editReply({ content: `モデル取得に失敗しました: ${message}` })
      }
      break
    }
  }
}
