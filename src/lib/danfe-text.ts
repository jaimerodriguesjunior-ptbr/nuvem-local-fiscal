// Standard PDF Helvetica metrics (1/1000 em), matching the DANFE's F1/F2 fonts.
const regular = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const bold = [278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,611,611,389,556,333,611,556,778,556,556,500,389,280,389,584];

function printable(value: string) {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7E]/g, '');
}

export function danfeTextWidth(value: string, size: number, font = 'F1') {
  const widths = font === 'F2' ? bold : regular;
  return [...printable(value)].reduce((sum, c) => sum + widths[c.charCodeAt(0) - 32], 0) * size / 1000;
}

export function wrapDanfeText(value: string, maxWidth: number, size: number, font = 'F1') {
  const lines: string[] = [];
  let current = '';
  for (const word of printable(value).split(/\s+/).filter(Boolean)) {
    const candidate = current ? `${current} ${word}` : word;
    if (danfeTextWidth(candidate, size, font) <= maxWidth) { current = candidate; continue; }
    if (current) { lines.push(current); current = ''; }
    for (const character of word) {
      if (current && danfeTextWidth(current + character, size, font) > maxWidth) {
        lines.push(current); current = '';
      }
      current += character;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [''];
}
