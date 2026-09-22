const ARABIC_TO_PERSIAN: Record<string, string> = {
  ي: "ی",
  ى: "ی",
  ك: "ک",
  ة: "ه",
 ۀ: "ه",
 ؤ: "و",
};

export function normalizePersianText(value: string): string {
  let text = value.normalize("NFC");
  text = [...text].map((char) => ARABIC_TO_PERSIAN[char] ?? char).join("");
  text = text.replace(/[\u064B-\u065F\u0670]/gu, "");
  text = text.replace(/[\u200c\u200d]+/gu, "‌");
  text = text.replace(/[ \t]+/gu, " ");
  text = text.replace(/\s+([،؛؟!,:;.])/gu, "$1");
  text = text.replace(/([،؛؟!,:;.])(?=\S)/gu, "$1 ");
  return text.trim();
}
