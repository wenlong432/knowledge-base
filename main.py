from fastapi import FastAPI, UploadFile, File
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import Chroma
from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from dotenv import load_dotenv
import os
import json
import tempfile
import asyncio

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 初始化embedding模型
embeddings = HuggingFaceEmbeddings(
    model_name="paraphrase-multilingual-MiniLM-L12-v2"
)

# 初始化LLM
llm = ChatOpenAI(
    api_key=os.getenv("SILICONFLOW_API_KEY"),
    base_url="https://api.siliconflow.cn/v1",
    model="deepseek-ai/DeepSeek-V3",
    streaming=True
)

# 全局向量数据库
vectorstore = None
uploaded_files = []

def send_event(event_type: str, data: dict) -> str:
    return f"data: {json.dumps({'type': event_type, **data}, ensure_ascii=False)}\n\n"

@app.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    global vectorstore, uploaded_files

    # 保存上传的文件到临时目录
    suffix = ".pdf" if file.filename.endswith(".pdf") else ".txt"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    # 加载文档
    if suffix == ".pdf":
        loader = PyPDFLoader(tmp_path)
        documents = loader.load()
    else:
        from langchain_community.document_loaders import TextLoader
        loader = TextLoader(tmp_path, encoding="utf-8")
        documents = loader.load()

    # 给每个文档打上来源标签
    for doc in documents:
        doc.metadata["source"] = file.filename

    # 切片
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=500,
        chunk_overlap=50
    )
    chunks = splitter.split_documents(documents)

    # 存入向量数据库
    if vectorstore is None:
        vectorstore = Chroma.from_documents(chunks, embeddings)
    else:
        vectorstore.add_documents(chunks)

    uploaded_files.append(file.filename)
    os.unlink(tmp_path)

    return {
        "success": True,
        "filename": file.filename,
        "chunks": len(chunks),
        "total_files": len(uploaded_files)
    }

@app.get("/files")
def get_files():
    return {"files": uploaded_files}

@app.post("/chat")
async def chat(request: dict):
    global vectorstore

    query = request.get("message", "")
    history = request.get("history", [])

    async def generate():
        if vectorstore is None:
            yield send_event("error", {"content": "请先上传文档"})
            return

        # 检索相关文档
        yield send_event("thinking", {"content": "检索相关文档..."})
        await asyncio.sleep(0.1)

        docs = vectorstore.similarity_search(query, k=3)

        # 推送检索到的文档来源
        sources = []
        for doc in docs:
            source = {
                "filename": doc.metadata.get("source", "未知"),
                "page": doc.metadata.get("page", 0) + 1,
                "preview": doc.page_content[:80] + "..."
            }
            if source not in sources:
                sources.append(source)

        yield send_event("sources", {"sources": sources})
        await asyncio.sleep(0.1)

        # 构建context
        context = "\n\n".join([doc.page_content for doc in docs])

        # 构建消息历史
        messages = []
        for msg in history[-6:]:  # 只保留最近6条
            messages.append(msg)
        messages.append({"role": "user", "content": query})

        # 构建prompt
        system_prompt = f"""你是一个专业的知识库助手。请根据以下文档内容回答用户问题。
如果文档中没有相关信息，请直接说"文档中未找到相关信息"，不要编造答案。

【文档内容】
{context}"""

        yield send_event("thinking", {"content": "生成回答..."})
        await asyncio.sleep(0.1)

        # 流式生成回答
        full_messages = [
            {"role": "system", "content": system_prompt},
            *messages
        ]

        from openai import OpenAI
        client = OpenAI(
            api_key=os.getenv("SILICONFLOW_API_KEY"),
            base_url="https://api.siliconflow.cn/v1"
        )

        stream = client.chat.completions.create(
            model="deepseek-ai/DeepSeek-V3",
            messages=full_messages,
            stream=True
        )

        for chunk in stream:
            content = chunk.choices[0].delta.content
            if content:
                yield send_event("text", {"content": content})

        yield send_event("done", {})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no"
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)