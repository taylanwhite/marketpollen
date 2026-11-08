// Prints a weekly highlights draft for one marketer, without sending anything.
// Needs web/.env (DATABASE_URL, OPENAI_API_KEY) and `npm run build:handlers` first.
//   node scripts/weekly-highlights-example.mjs "Kelli White" 2026-11-02 2026-11-08
import { prisma } from '../dist-handlers/lib/db.js';
import { getOpenAI } from '../dist-handlers/lib/ai.js';
import { loadWeek, draftHighlights, statsLine } from '../dist-handlers/weekly-highlights.js';

const [name = 'Kelli White', fromArg, toArg] = process.argv.slice(2);

function lastWeek() {
  const today = new Date();
  const monday = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate() - ((today.getDay() + 6) % 7) - 7));
  return [monday, new Date(monday.getTime() + 7 * 86_400_000)];
}
const [from, to] = fromArg && toArg
  ? [new Date(`${fromArg}T00:00:00Z`), new Date(new Date(`${toArg}T00:00:00Z`).getTime() + 86_400_000)]
  : lastWeek();

const [first, ...rest] = name.split(' ');
const users = await prisma.user.findMany({
  where: {
    OR: [
      { display_name: { contains: name, mode: 'insensitive' } },
      { AND: [{ email: { contains: first, mode: 'insensitive' } }, { email: { contains: rest.join('') || first, mode: 'insensitive' } }] },
    ],
  },
  select: { id: true, display_name: true, email: true },
});
if (users.length === 0) throw new Error(`No user matches "${name}"`);
if (users.length > 1) console.log('Several matches, using the first:', users);
const user = users[0];

// Every store she logged visits in that week.
const stores = await prisma.reachout.findMany({
  where: { created_by: user.id, date: { gte: from, lt: to } },
  select: { contact: { select: { store_id: true } } },
  distinct: ['contact_id'],
});
const storeIds = [...new Set(stores.map((s) => s.contact.store_id))];
if (storeIds.length === 0) console.log(`${user.display_name || user.email} logged no visits ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}.`);

const openai = getOpenAI();
if (!openai) throw new Error('OPENAI_API_KEY is not set');
for (const storeId of storeIds) {
  const week = await loadWeek(storeId, user.id, from, to);
  const draft = await draftHighlights(openai, week);
  console.log(`\n===== ${week.storeName} =====`);
  console.log(`Subject: Weekly Highlights ${week.weekLabel}\n`);
  console.log(draft.intro + '\n');
  for (const b of draft.bullets) console.log(`- ${b}`);
  console.log(`\nThis week: ${statsLine(week.stats)}`);
}
await prisma.$disconnect();
