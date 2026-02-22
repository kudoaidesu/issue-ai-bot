import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from 'discord.js'

export const COLORS = {
  success: 0x238636,
  info: 0x1f6feb,
  warning: 0xd29922,
  error: 0xda3633,
} as const

export const STATUS_EMOJI: Record<string, string> = {
  pending: '\u23f3',
  processing: '\ud83d\udd04',
  completed: '\u2705',
  failed: '\u274c',
}

// --- Button / Select Menu Helpers ---

export const CUSTOM_ID = {
  queueProcessNow: (id: string) => `queue_process:${id}`,
  queueRemove: (id: string) => `queue_remove:${id}`,
  prMerge: (prUrl: string) => `pr_merge:${prUrl}`,
  projectSelect: 'project_select',
} as const

export function parseCustomId(customId: string): { action: string; payload: string } {
  const idx = customId.indexOf(':')
  if (idx === -1) return { action: customId, payload: '' }
  return { action: customId.slice(0, idx), payload: customId.slice(idx + 1) }
}

export function createQueueButtons(queueItemId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(CUSTOM_ID.queueProcessNow(queueItemId))
      .setLabel('今すぐ処理')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(CUSTOM_ID.queueRemove(queueItemId))
      .setLabel('キューから削除')
      .setStyle(ButtonStyle.Danger),
  )
}

export function createPrButtons(prUrl: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('PR を見る')
      .setStyle(ButtonStyle.Link)
      .setURL(prUrl),
    new ButtonBuilder()
      .setCustomId(CUSTOM_ID.prMerge(prUrl))
      .setLabel('承認 & マージ')
      .setStyle(ButtonStyle.Success),
  )
}

export function createProjectSelectMenu(
  projects: Array<{ slug: string; repo: string }>,
): ActionRowBuilder<StringSelectMenuBuilder> {
  const select = new StringSelectMenuBuilder()
    .setCustomId(CUSTOM_ID.projectSelect)
    .setPlaceholder('プロジェクトを選択してください')
    .addOptions(
      projects.map((p) => ({
        label: p.slug,
        description: p.repo,
        value: p.slug,
      })),
    )

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)
}

// --- Embed Helpers ---

export function createEmbed(
  color: number,
  title: string,
  options?: {
    description?: string
    url?: string
    fields?: Array<{ name: string; value: string; inline?: boolean }>
    footer?: string
  },
): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(color).setTitle(title).setTimestamp()

  if (options?.description) embed.setDescription(options.description)
  if (options?.url) embed.setURL(options.url)
  if (options?.fields) embed.addFields(options.fields)
  if (options?.footer) embed.setFooter({ text: options.footer })

  return embed
}
