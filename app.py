import os
import json
import concurrent.futures
from flask import Flask, request, jsonify, send_from_directory
from groq import Groq
from google import genai
from dotenv import load_dotenv
import prompts
import time

load_dotenv()
gemini_client = genai.Client(api_key=os.getenv('Gemini_API_KEY'))
app    = Flask(__name__, static_folder='.')
groq_client = Groq(api_key=os.getenv('GROQ_API_KEY'))


# ── Groq call (取消註解並確保回傳格式穩定) ───────────────────────────
def call_groq(prompt, model):
    response = groq_client.chat.completions.create(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        max_tokens=1000,
        response_format={"type": "json_object"} 
    )
    text = response.choices[0].message.content
    return json.loads(text)

# ── Gemini call ───────────────────────────────────────────────
def call_gemini(prompt, model):
    response = gemini_client.models.generate_content(
        model=model,
        contents=prompt
    )
    text = response.candidates[0].content.parts[-1].text
    # 清理 Markdown 代碼塊
    clean = text.replace('```json', '').replace('```', '').strip()
    return json.loads(clean)


# ── 路由：自動分流 ─────────────────────────────────────────────
def get_model_response(prompt, model_name, retries=3):
    last_err = None
    for i in range(retries):
        try:
            if "gemma" in model_name.lower():
                return call_gemini(prompt, model_name)
            else:
                return call_groq(prompt, model_name)
        except json.JSONDecodeError as e:
            last_err = e
            if i < retries - 1:
                time.sleep(1 * (i + 1))
                continue
            raise
        except Exception as e:
            raise  # 非 JSON 錯誤不 retry，直接拋
    raise last_err

# ── Serve static files ─────────────────────────────────────────
@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('.', path)


# ── Evaluate endpoint ──────────────────────────────────────────
@app.route('/api/evaluate', methods=['POST'])
def evaluate():
    data       = request.get_json()
    petition   = data.get('petition', '').strip()
    civil      = data.get('civil', '').strip()
    reply      = data.get('reply', '').strip()
    model      = data.get('model', 'llama-3.3-70b-versatile')
    dimensions = data.get('dimensions', ['completeness', 'fidelity', 'tone'])

    if not petition or not reply:
        return jsonify({'error': '缺少必要欄位'}), 400
    if 'fidelity' in dimensions and not civil:
        return jsonify({'error': '評估忠實性需要提供公務員想回答的內容'}), 400
    if not dimensions:
        return jsonify({'error': '請至少選擇一個評估維度'}), 400

    # 依勾選的維度建立要執行的任務
    tasks = {}
    if 'completeness' in dimensions:
        tasks['completeness'] = prompts.completeness(petition, reply)
    if 'fidelity' in dimensions:
        tasks['fidelity'] = prompts.fidelity(petition, civil, reply)
    if 'tone' in dimensions:
        tasks['tone'] = prompts.tone(reply)

    # 平行呼叫
    results = {}
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(get_model_response, prompt, model): dim
            for dim, prompt in tasks.items()
        }
        for future in concurrent.futures.as_completed(futures):
            dim = futures[future]
            try:
                results[dim] = future.result()
            except json.JSONDecodeError as e:
                return jsonify({'error': f'{dim}: 模型回傳格式錯誤', 'detail': str(e)}), 422
            except Exception as e:
                import traceback
                traceback.print_exc()  # 加這行！
                return jsonify({'error': f'{dim}: {str(e)}'}), 500

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
