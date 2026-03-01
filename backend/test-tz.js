const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
const parts = new Intl.DateTimeFormat('en-US', options).formatToParts(new Date());
const map = {};
for (const part of parts) {
  if (part.type !== 'literal') map[part.type] = part.value;
}
console.log(`${map.year}-${map.month}-${map.day}T${map.hour}:${map.minute}:${map.second}.000Z`);
const d = new Date(map.year, parseInt(map.month) - 1, map.day, map.hour, map.minute, map.second);
console.log(d.getHours(), map.hour);
