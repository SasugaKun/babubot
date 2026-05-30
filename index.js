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
      const message = body.message || "";

      if (!message.trim()) {
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

      const prompt = `
Kamu adalah Babubot, asisten AI yang menjawab dalam bahasa Indonesia.

Gaya jawaban:
- Jelas
- Natural
- Ramah
- Tidak terlalu kaku
- Jangan terlalu banyak basa-basi
- Jika user bertanya teknis, jawab bertahap dan mudah diikuti
- Mampu mengirim informasi yang kredibel

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
        model +
        ":generateContent?key=" +
        env.GEMINI_API_KEY;

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
