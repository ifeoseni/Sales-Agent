import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(root, '.env');

let token = process.env.TELEGRAM_BOT_TOKEN;
if (!token && fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const match = content.match(/^TELEGRAM_BOT_TOKEN=(.+)$/m);
  if (match) token = match[1].trim();
}

if (!token) {
  console.error('Error: TELEGRAM_BOT_TOKEN not found in environment or .env file.');
  process.exit(1);
}

console.log('--- Telegram Channel ID Finder ---');
console.log('Using bot token: ' + token.slice(0, 10) + '...' + token.slice(-5));
console.log('Looking for channel: "Code Tech Sales Channel"');
console.log('\n--> Please send a test message (e.g. "test") in your Telegram channel now.\n');

async function checkUpdates() {
  const url = `https://api.telegram.org/bot${token}/getUpdates?allowed_updates=["channel_post","my_chat_member"]&timeout=10`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) {
      if (data.error_code === 409) {
        console.log('Notice: Another bot instance is currently active on your server.');
        console.log('Tip: You can either temporarily stop the Node project in aaPanel for 30 seconds,');
        console.log('OR simply forward any message from "Code Tech Sales Channel" to @userinfobot in Telegram to get the ID instantly.\n');
      } else {
        console.error('Telegram API error:', data.description);
      }
      return null;
    }

    for (const update of data.result || []) {
      const chat = update.channel_post?.chat || update.my_chat_member?.chat;
      if (chat && (chat.type === 'channel' || chat.type === 'supergroup')) {
        return chat;
      }
    }
    return null;
  } catch (err) {
    console.error('Network error:', err.message);
    return null;
  }
}

let attempts = 0;
const interval = setInterval(async () => {
  attempts++;
  process.stdout.write(`Waiting for channel activity... (attempt ${attempts}/15)\r`);
  const chat = await checkUpdates();
  if (chat) {
    clearInterval(interval);
    console.log('\n\n==============================================');
    console.log(` SUCCESS! Channel Detected:`);
    console.log(` Title: ${chat.title}`);
    console.log(` Channel ID: ${chat.id}`);
    console.log(` Type: ${chat.type}`);
    if (chat.username) console.log(` Username: @${chat.username}`);
    console.log('==============================================\n');
    console.log(`Add this line to your .env on the server:`);
    console.log(`TELEGRAM_CHANNEL_ID=${chat.id}\n`);
    process.exit(0);
  }

  if (attempts >= 15) {
    clearInterval(interval);
    console.log('\n\nTimed out waiting for channel message.');
    console.log('Fastest alternative:');
    console.log('1. Go to Telegram on your phone or PC.');
    console.log('2. Send any message in "Code Tech Sales Channel".');
    console.log('3. Forward that message to @userinfobot or @JsonDumpBot.');
    console.log('4. The bot will instantly return the channel ID (usually starts with -100...).');
  }
}, 3000);

