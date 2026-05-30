export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders()
      });
    }

    if (request.method !== "POST") {
      return jsonResponse(
        {
          error: "Gunakan method POST."
        },
        405
      );
    }

    try {
      const body = await request.json();
      const message = String(body.message || "").trim();
      const userId = sanitizeUserId(body.userId || "default");

      if (!message) {
        return jsonResponse(
          {
            error: "Pesan kosong."
          },
          400
        );
      }

      if (!env.GEMINI_API_KEY) {
        return jsonResponse(
          {
            error: "GEMINI_API_KEY belum disetel di Worker."
          },
          500
        );
      }

      const model = env.GEMINI_MODEL || "gemini-3.0-flash";
      const memoryKey = `babubot:memory:${userId}`;

      let memory = [];
      if (env.BABUBOT_KV) {
        memory = await loadMemory(env, memoryKey);
      }

      const memoryText = buildMemoryText(memory);

      const prompt = `
Kamu adalah BabuBot, asisten AI yang menjawab dalam bahasa Indonesia.

Memori percakapan yang relevan:
${memoryText}

Gaya jawaban:
- Jelas
- Natural
- Ramah
- Tidak terlalu kaku
- Jangan terlalu banyak basa-basi
- Jika user bertanya teknis, jawab bertahap dan mudah diikuti
- Mampu mengirim informasi yang kredibel
- Jika mengirim kode pemrograman, gunakan blok kode markdown dengan triple backtick

Pesan user:
${message}
`.trim();

      const geminiBody = {
        contents: [
          {
            role: "user",
            parts: [
              {
                text: prompt
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          topP: 0.9,
          maxOutputTokens: 4096
        }
      };

      const geminiUrl =
        "https://generativelanguage.googleapis.com/v1beta/models/" +
        encodeURIComponent(model) +
        ":generateContent?key=" +
        encodeURIComponent(env.GEMINI_API_KEY);

      const geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(geminiBody)
      });

      const geminiData = await geminiRes.json();

      if (!geminiRes.ok) {
        return jsonResponse(
          {
            error: "Gemini API error.",
            model,
            detail: geminiData
          },
          geminiRes.status
        );
      }

      const text = extractText(geminiData);

      if (env.BABUBOT_KV) {
        const updatedMemory = updateMemory(memory, message, text);
        await env.BABUBOT_KV.put(memoryKey, JSON.stringify(updatedMemory));
      }

      return jsonResponse({
        ok: true,
        model,
        text
      });
    } catch (err) {
      return jsonResponse(
        {
          error: err.message || "Terjadi error."
        },
        500
      );
    }
  }
};

function sanitizeUserId(userId) {
  return (
    String(userId || "default")
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 80) || "default"
  );
}

async function loadMemory(env, memoryKey) {
  try {
    const savedMemory = await env.BABUBOT_KV.get(memoryKey);
    const parsed = savedMemory ? JSON.parse(savedMemory) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    return [];
  }
}

function buildMemoryText(memory) {
  if (!Array.isArray(memory) || memory.length === 0) {
    return "Belum ada memori.";
  }

  return memory
    .slice(-10)
    .map((item, index) => {
      const user = item.user ? `User: ${item.user}` : "";
      const ai = item.ai ? `BabuBot: ${item.ai}` : "";
      return `${index + 1}. ${[user, ai].filter(Boolean).join(" | ")}`;
    })
    .join("\n");
}

function updateMemory(memory, userMessage, aiReply) {
  const nextMemory = Array.isArray(memory) ? [...memory] : [];

  nextMemory.push({
    user: limitText(userMessage, 700),
    ai: limitText(aiReply, 900),
    time: new Date().toISOString()
  });

  return nextMemory.slice(-20);
}

function limitText(text, maxLength) {
  const value = String(text || "").trim();
  return value.length > maxLength ? value.slice(0, maxLength) + "..." : value;
}

function extractText(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];

  const text = parts
    .map((part) => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  return text || "Tidak ada jawaban dari Gemini.";
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders()
    }
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
