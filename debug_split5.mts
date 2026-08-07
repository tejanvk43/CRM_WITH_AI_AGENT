import { allChunks } from "./server/knowledge/seed";
import { retrieve, groundedAnswer } from "./server/knowledge/retrieval";

for (const c of allChunks) {
  if (c.text.includes("genuinely zero-cost")) {
    console.log("CHUNK:", c.id);
    console.log("FIRST 120:", JSON.stringify(c.text.slice(0, 120)));
    console.log("char0:", JSON.stringify(c.text.charAt(0)));
  }
}

// Reproduce answer and show each picked sentence with its chunk
const ans = groundedAnswer("pricing fees charges", allChunks);
console.log("ANSWER:", ans.answer.slice(0, 400));
