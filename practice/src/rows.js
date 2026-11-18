export const CITIES = ["Paris", "Lyon", "Lille", "Nantes", "Nice", "Brest", "Tours", "Dijon"];

/** The practice table: 5,000 rows, a new array on each call. */
export function allRows() {
  const rows = [];
  for (let id = 1; id <= 5000; id++) {
    rows.push({
      id,
      name: `row-${String(id).padStart(4, "0")}`,
      city: CITIES[(id - 1) % 8],
      amount: (id * 37) % 1000,
    });
  }
  return rows;
}
