import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { PRESET_NAMES } from '../scoring/index.js';

export const commands = [
  new SlashCommandBuilder().setName('verify').setDescription('Link your GitHub and get placed into a tier'),

  new SlashCommandBuilder()
    .setName('score')
    .setDescription('Show a Cracked Score receipt')
    .addUserOption((o) => o.setName('user').setDescription('Another member (mods only)')),

  new SlashCommandBuilder().setName('unlink').setDescription('Unlink your GitHub and remove your tier roles'),

  new SlashCommandBuilder().setName('leaderboard').setDescription('Top Cracked Scores in this server'),

  new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Configure crackedbot for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('verify-channel')
        .setDescription('Where members run /verify and welcomes are posted')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true),
    )
    .addChannelOption((o) =>
      o
        .setName('modlog-channel')
        .setDescription('One line per attempt')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addChannelOption((o) =>
      o
        .setName('review-channel')
        .setDescription('Borderline cases land here with Approve/Deny buttons')
        .addChannelTypes(ChannelType.GuildText),
    ),

  new SlashCommandBuilder()
    .setName('rubric')
    .setDescription('View or change how this server scores applicants')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('view').setDescription('Show the current rubric'))
    .addSubcommand((s) =>
      s
        .setName('preset')
        .setDescription('Apply a preset')
        .addStringOption((o) =>
          o
            .setName('name')
            .setDescription('Preset')
            .setRequired(true)
            .addChoices(...PRESET_NAMES.map((p) => ({ name: p, value: p }))),
        ),
    )
    .addSubcommand((s) =>
      s
        .setName('tier')
        .setDescription('Map a tier to a role')
        .addStringOption((o) => o.setName('name').setDescription('Tier name, e.g. Builder').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to grant; omit to clear')),
    )
    .addSubcommand((s) =>
      s
        .setName('entry')
        .setDescription('Set the lowest tier that is admitted')
        .addStringOption((o) => o.setName('name').setDescription('Tier name').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('export').setDescription('Download the rubric as JSON'))
    .addSubcommand((s) =>
      s
        .setName('import')
        .setDescription('Replace the rubric from a JSON file')
        .addAttachmentOption((o) => o.setName('file').setDescription('rubric.json').setRequired(true)),
    ),

  new SlashCommandBuilder()
    .setName('whois')
    .setDescription('Show a member’s linked GitHub and latest score')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),

  new SlashCommandBuilder()
    .setName('rescore')
    .setDescription('Re-run the analysis for a linked member (public data only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),

  new SlashCommandBuilder()
    .setName('review')
    .setDescription('List open manual reviews')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
];
