/**
 * True when `html` holds `value` as a whole number token, written plain ("2137") or with a
 * thousands comma ("2,137"). A digit, comma or decimal point on either side means it is part
 * of a different number, so "12,137" and "2.137" do not count.
 */
export function containsExactNumber(html: string, value: number): boolean {
  return [String(value), value.toLocaleString('en-US')].some((spelling) =>
    new RegExp(`(?<![\\d.,])${spelling}(?![\\d,]|\\.\\d)`).test(html),
  );
}
