import os
import json
import concurrent.futures
from flask import Flask, request, jsonify, send_from_directory
from groq import Groq
from dotenv import load_dotenv
import prompts

load_dotenv()

app    = Flask(__name__, static_folder='.')
client = Groq(api_key=os.getenv('GROQ_API_KEY'))


# ── Groq call ──────────────────────────────────────────────────
def call_groq(prompt, model):
    response = client.chat.completions.create(
        model=model,
        messages=[{'role': 'user', 'content': prompt}],
        max_tokens=1000,
    )
    text  = response.choices[0].message.content
    clean = text.replace('```json', '').replace('```', '').strip()
    return json.loads(clean)


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
        tasks['fidelity'] = prompts.fidelity(civil, reply)
    if 'tone' in dimensions:
        tasks['tone'] = prompts.tone(reply)

    # 平行呼叫 groq
    results = {}
    with concurrent.futures.ThreadPoolExecutor() as executor:
        futures = {
            executor.submit(call_groq, prompt, model): dim
            for dim, prompt in tasks.items()
        }
        for future in concurrent.futures.as_completed(futures):
            dim = futures[future]
            try:
                results[dim] = future.result()
            except json.JSONDecodeError as e:
                return jsonify({'error': f'{dim}: 模型回傳格式錯誤', 'detail': str(e)}), 502
            except Exception as e:
                return jsonify({'error': f'{dim}: {str(e)}'}), 500

    return jsonify(results)


if __name__ == '__main__':
    app.run(debug=True, port=5000)
