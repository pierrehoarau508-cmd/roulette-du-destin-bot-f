require('dotenv').config();

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const path       = require('path');

// ── Serveur web ─────────────────────────────────────────────────────
const app        = express();
const httpServer = http.createServer(app);
const io         = new Server(httpServer, { cors: { origin: '*' } });

app.use(express.static(path.join(__dirname, 'public')));

// ── État de la roue ─────────────────────────────────────────────────
const state = {
  segments    : ['🍋 Rayan','💎 Pierre','🔥 Terrence','💀 Arthur','⭐ Ajay','⭐ Vijay','🃏 Noe','🪙 Ezeckiel','🎮 Nathan','🌙 Nayel','🎯 Maxime','⚡ Sylvain','🌸 Tayva','🎲 Jérémie'],
  spinning    : false,
  lastResult  : null,
  spinCount   : 0,
  currentAngle: 0,
};

// ── Calcul du spin ──────────────────────────────────────────────────
function computeSpin() {
  const n        = state.segments.length;
  const winIndex = Math.floor(Math.random() * n);
  const arcSize  = (Math.PI * 2) / n;

  // L'aiguille est à droite (angle 0).
  // La roue dessine le segment i à partir de (currentAngle + i*arcSize).
  // Pour que le CENTRE du segment gagnant tombe sur l'aiguille (angle 0),
  // on calcule combien il faut ajouter à currentAngle :
  //   currentAngle + winIndex*arcSize + arcSize/2 ≡ 0  (mod 2π)
  // => delta = -(currentAngle + winIndex*arcSize + arcSize/2)  (mod 2π)
  const currentMod = ((state.currentAngle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const segStart   = (winIndex * arcSize + arcSize / 2);
  let   delta      = (Math.PI * 2) - ((currentMod + segStart) % (Math.PI * 2));
  if (delta < 0.01) delta += Math.PI * 2; // évite delta ≈ 0

  const extra = (5 + Math.floor(Math.random() * 4)) * Math.PI * 2;
  state.currentAngle += extra + delta;
  state.spinCount++;
  return { winIndex, result: state.segments[winIndex] };
}

// ── Envoi résultat sur Discord ──────────────────────────────────────
async function notifyDiscord(result, user, source) {
  if (!process.env.DISCORD_CHANNEL_ID || !discordReady) return;
  try {
    const channel = discordClient.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;
    const { EmbedBuilder } = require('discord.js');
    const desc = source === 'web'
      ? `🌐 Lancé depuis le site !\n\n🎯 Résultat : ||**${result}**||`
      : `**${user}** a lancé la roue !\n\n🎯 Résultat : ||**${result}**||`;
    await channel.send({ embeds: [
      new EmbedBuilder()
        .setTitle('🎰 Roue du Destin')
        .setDescription(desc)
        .setColor(0x00FF7F)
        .setFooter({ text: `Spin #${state.spinCount}` })
        .setTimestamp()
    ]});
  } catch (e) {
    console.error('Discord notify error:', e.message);
  }
}

// ── Socket.io ───────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.emit('wheel-update', { segments: state.segments });
  if (state.lastResult) socket.emit('spin-result', { result: state.lastResult });

  socket.on('request-spin', () => {
    if (state.spinning || state.segments.length < 2) return;
    state.spinning = true;
    const { winIndex, result } = computeSpin();
    state.lastResult = result;
    io.emit('spin-start', { segments: state.segments, finalAngle: state.currentAngle, winIndex });
    setTimeout(() => {
      state.spinning = false;
      io.emit('spin-result', { result });
      notifyDiscord(result, null, 'web');
    }, 6200);
  });
});

// ── Démarrage HTTP ──────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => console.log(`✅ Serveur web démarré sur le port ${PORT}`));

// ── Bot Discord (optionnel) ─────────────────────────────────────────
let discordClient = null;
let discordReady  = false;

if (!process.env.DISCORD_TOKEN) {
  console.warn('⚠️  DISCORD_TOKEN absent — bot Discord désactivé');
} else {
  const {
    Client, GatewayIntentBits,
    REST, Routes,
    SlashCommandBuilder,
    EmbedBuilder,
  } = require('discord.js');

  discordClient = new Client({ intents: [GatewayIntentBits.Guilds] });

  const COMMANDS = [
    new SlashCommandBuilder().setName('spin').setDescription('🎰 Lance la roue !'),
    new SlashCommandBuilder().setName('add').setDescription('➕ Ajoute un segment')
      .addStringOption(o => o.setName('segment').setDescription('Texte').setRequired(true)),
    new SlashCommandBuilder().setName('remove').setDescription('➖ Supprime un segment')
      .addIntegerOption(o => o.setName('numero').setDescription('Numéro dans /list').setRequired(true).setMinValue(1)),
    new SlashCommandBuilder().setName('list').setDescription('📋 Liste les segments'),
    new SlashCommandBuilder().setName('clear').setDescription('♻️ Remet la roue par défaut'),
    new SlashCommandBuilder().setName('wheel').setDescription('🔗 Lien vers la roue'),
  ].map(c => c.toJSON());

  discordClient.once('ready', async () => {
    discordReady = true;
    console.log(`✅ Bot Discord connecté : ${discordClient.user.tag}`);
    try {
      const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
      await rest.put(
        Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
        { body: COMMANDS }
      );
      console.log('✅ Commandes slash enregistrées');
    } catch (e) {
      console.error('❌ Erreur enregistrement commandes:', e.message);
    }
  });

  discordClient.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const cmd  = interaction.commandName;
    const user = interaction.user.displayName ?? interaction.user.username;

    if (cmd === 'spin') {
      if (state.spinning)
        return interaction.reply({ content: '⏳ La roue tourne déjà !', ephemeral: true });
      if (state.segments.length < 2)
        return interaction.reply({ content: '❌ Il faut au moins 2 segments.', ephemeral: true });

      state.spinning = true;
      const { result } = computeSpin();
      state.lastResult = result;

      io.emit('spin-start', { segments: state.segments, finalAngle: state.currentAngle });

      await interaction.reply({ embeds: [
        new EmbedBuilder()
          .setTitle('🎰 La roue tourne !')
          .setDescription(`**${user}** a lancé la roue !\n\n🔴 **[Regarder en direct](${process.env.PUBLIC_URL || '#'})**`)
          .setColor(0xFFD700)
          .setFooter({ text: `Spin #${state.spinCount}` })
          .setTimestamp()
      ]});

      // Garde le channelId avant le timeout (l'interaction expire après 3s)
      const channelId = interaction.channelId;

      setTimeout(async () => {
        state.spinning = false;
        io.emit('spin-result', { result });
        // ✅ channel.send() au lieu de followUp() — évite DiscordAPIError[10062]
        try {
          const channel = discordClient.channels.cache.get(channelId);
          if (channel) {
            await channel.send({ embeds: [
              new EmbedBuilder()
                .setTitle('🎯 Résultat !')
                .setDescription(`**${user}** a obtenu :\n\n||**${result}**||\n\n*Clique pour révéler !*`)
                .setColor(0x00FF7F)
                .setTimestamp()
            ]});
          }
        } catch (e) {
          console.error('Erreur envoi résultat:', e.message);
        }
      }, 6200);
    }

    if (cmd === 'add') {
      const seg = interaction.options.getString('segment');
      if (state.segments.length >= 16)
        return interaction.reply({ content: '❌ Maximum 16 segments !', ephemeral: true });
      state.segments.push(seg);
      io.emit('wheel-update', { segments: state.segments });
      await interaction.reply({ embeds: [
        new EmbedBuilder().setTitle('✅ Segment ajouté')
          .setDescription(`**${seg}** ajouté. Total : **${state.segments.length}**`).setColor(0x57F287)
      ]});
    }

    if (cmd === 'remove') {
      const idx = interaction.options.getInteger('numero') - 1;
      if (idx < 0 || idx >= state.segments.length)
        return interaction.reply({ content: `❌ Numéro invalide (1–${state.segments.length})`, ephemeral: true });
      const [removed] = state.segments.splice(idx, 1);
      io.emit('wheel-update', { segments: state.segments });
      await interaction.reply({ embeds: [
        new EmbedBuilder().setTitle('🗑️ Segment supprimé')
          .setDescription(`**${removed}** retiré.`).setColor(0xED4245)
      ]});
    }

    if (cmd === 'list') {
      const list = state.segments.map((s, i) => `\`${i+1}.\` ${s}`).join('\n');
      await interaction.reply({ embeds: [
        new EmbedBuilder().setTitle('🎡 Segments')
          .setDescription(list || 'Aucun segment').setColor(0x5865F2)
          .setFooter({ text: `${state.segments.length} segments` })
      ]});
    }

    if (cmd === 'clear') {
      state.segments = ['🍋 Citron','💎 Diamant','🔥 Jackpot','💀 Zéro','⭐ Bonus','🎁 Cadeau','🃏 Joker','🪙 Or'];
      io.emit('wheel-update', { segments: state.segments });
      await interaction.reply('♻️ Roue réinitialisée !');
    }

    if (cmd === 'wheel') {
      await interaction.reply({ embeds: [
        new EmbedBuilder().setTitle('🎰 Roue — En direct')
          .setDescription(`🔴 **[Ouvrir la roue](${process.env.PUBLIC_URL || '#'})**`)
          .setColor(0xFFD700)
      ]});
    }
  });

  discordClient.login(process.env.DISCORD_TOKEN)
    .catch(e => console.error('❌ Connexion Discord échouée:', e.message));
}
