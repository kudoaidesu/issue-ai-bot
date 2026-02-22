import { EmbedBuilder } from 'discord.js'

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
