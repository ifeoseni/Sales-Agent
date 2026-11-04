// Lost the dashboard password? Stop the agent, run `npm run reset-password`, start it again:
// a new one-time password is generated and printed in the terminal.
// (Does nothing if the password comes from the ADMIN_PASSWORD environment variable: change that instead.)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(path.resolve(process.env.DATA_DIR || path.join(root, 'data')), 'settings.json');

if (!fs.existsSync(file)) { console.error('No settings file at ' + file + '. Just start the agent: it will print a first-run password.'); process.exit(1); }
const s = JSON.parse(fs.readFileSync(file, 'utf8'));
delete s.passwordHash;
delete s.adminPassword;
s.sessionSecret = ''; // also signs everyone out
fs.writeFileSync(file, JSON.stringify(s, null, 2));
console.log('Password cleared and all sessions invalidated. Start the agent (npm start); it prints a new password.');
if (process.env.ADMIN_PASSWORD) console.log('Note: ADMIN_PASSWORD is set in this shell and will still take precedence.');
