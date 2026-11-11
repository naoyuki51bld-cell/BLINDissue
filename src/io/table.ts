// CSV / TSV / Excel から 2 次元の文字列表を作る
export type Table = string[][];

export function parseDelimited(text: string): Table {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delim = firstLine.includes('\t') ? '\t' : firstLine.split(',').length > 1 ? ',' : '\t';
  const rows: Table = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === '') inQuotes = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return trimTable(rows);
}

export function trimTable(rows: Table): Table {
  const cleaned = rows.map((r) => r.map((c) => (c ?? '').toString().trim()));
  while (cleaned.length && cleaned[cleaned.length - 1].every((c) => c === '')) cleaned.pop();
  return cleaned;
}

export async function readExcel(file: File): Promise<{ sheets: string[]; read: (sheet: string) => Promise<Table> }> {
  const mod = await import('read-excel-file');
  const readXlsxFile = mod.default;
  const sheets = (await mod.readSheetNames(file)) as string[];
  return {
    sheets,
    read: async (sheet) => {
      const rows = await readXlsxFile(file, { sheet });
      return trimTable(rows.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c)))));
    },
  };
}

export function toCsv(rows: Table): string {
  return rows
    .map((r) => r.map((c) => (/[",\n\r]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join(','))
    .join('\r\n');
}

export function download(filename: string, content: BlobPart, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function writeExcel(filename: string, sheets: { name: string; rows: Table }[]) {
  const { default: writeXlsxFile } = await import('write-excel-file');
  const data = sheets.map((s) => s.rows.map((r) => r.map((c) => ({ value: c, wrap: true }))));
  await writeXlsxFile(data as never, { sheets: sheets.map((s) => s.name.slice(0, 31)), fileName: filename });
}
