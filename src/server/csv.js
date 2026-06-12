export function splitCSVRow(str) {
  const result = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    if (char === '"' && str[i + 1] === '"') {
      current += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

export function parseCSV(text, onRow) {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = splitCSVRow(lines[0]);
  const rows = onRow ? null : [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const vals = splitCSVRow(line);
    const obj = {};
    headers.forEach((header, idx) => {
      obj[header] = vals[idx] !== undefined ? vals[idx] : "";
    });

    if (onRow) onRow(obj);
    else rows.push(obj);
  }

  return rows || [];
}
