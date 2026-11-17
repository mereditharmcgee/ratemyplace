/**
 * True when `html` holds `value` as a whole number token, in either of two shapes.
 *
 * As text: plain ("2137") or with a thousands comma ("2,137"). A digit, comma or decimal
 * point on either side means it is part of a different number, so "12,137" and "2.137" do
 * not count.
 *
 * As serialized data: after a colon or an opening bracket (`"rent_amount":2137`,
 * `[2137,2611]`) or as an Astro island prop value (`[0,2137]`, which Astro writes HTML-escaped
 * inside the props attribute). The text check alone cannot see these, because a comma sits
 * beside the number, and they are the most likely shape of a leak: review rows passed to a
 * client:load island or a JSON script. A number after a comma in a list (`[3,2137]`,
 * `[1500, 2137]`) counts too. For a three-digit value, a comma that ends a thousands-formatted
 * number does not (`1,817` is not 817), so `[3,817]` reads as 3,817 and is missed: fixture
 * values should not be three digits long where that matters.
 */
export function containsExactNumber(html: string, value: number): boolean {
  const plain = String(value);
  const textual = [plain, value.toLocaleString('en-US')].some((spelling) =>
    new RegExp(`(?<![\\d.,])${spelling}(?![\\d,]|\\.\\d)`).test(html),
  );
  // After a comma: any comma for a value that is not three digits long (no thousands group
  // is four digits), and for a three-digit value only a comma that does not end a
  // thousands-formatted number.
  const afterComma = plain.length === 3 ? `(?<!(?<![\\d,])\\d{1,3}(?:,\\d{3})*),\\s*` : `,\\s*`;
  const serialized = new RegExp(`(?:[:\\[]\\s*|\\[0,|${afterComma})${plain}(?![\\d.])`).test(html);
  return textual || serialized;
}
