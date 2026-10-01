import promptTemplate from "../../json生成prompt.txt?raw";

export const OCR_PROMPT = promptTemplate
  .replaceAll("{{CURRENT_YEAR}}", String(new Date().getFullYear()))
  .trim();
