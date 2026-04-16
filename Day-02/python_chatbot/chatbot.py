import os
import streamlit as st
from google import genai
from google.genai import types
from dotenv import load_dotenv

# -------------------- SETUP --------------------
load_dotenv()

API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY:
    st.error("GEMINI_API_KEY not found in .env file")
    st.stop()

client = genai.Client(api_key=API_KEY)
MODEL_NAME = "models/gemma-3-4b-it"

SYSTEM_PROMPT = """
You are an intelligent AI assistant.

Rules:
- Be clear, structured, and helpful
- Use bullet points when useful
- Ask clarifying questions if needed
- Give practical, actionable answers
- Avoid fluff
"""

# -------------------- SESSION STATE --------------------
if "history" not in st.session_state:
    st.session_state.history = []

    # Inject system prompt
    st.session_state.history.append(types.Content(
        role="user",
        parts=[types.Part.from_text(text=f"System: {SYSTEM_PROMPT}")]
    ))
    st.session_state.history.append(types.Content(
        role="model",
        parts=[types.Part.from_text(text="Understood.")]
    ))

if "messages" not in st.session_state:
    st.session_state.messages = []


# -------------------- TOOLS --------------------
def calculate(expression: str) -> str:
    try:
        return str(eval(expression))
    except:
        return "Invalid calculation"


# -------------------- MEMORY CONTROL --------------------
def trim_history():
    if len(st.session_state.history) > 20:
        st.session_state.history = (
            st.session_state.history[:2] +
            st.session_state.history[-18:]
        )


# -------------------- CHAT FUNCTION --------------------
def chat(user_input: str):
    # Tool trigger
    if user_input.startswith("calc:"):
        return calculate(user_input.replace("calc:", ""))

    st.session_state.history.append(types.Content(
        role="user",
        parts=[types.Part.from_text(text=user_input)]
    ))

    trim_history()

    stream = client.models.generate_content_stream(
        model=MODEL_NAME,
        contents=st.session_state.history,
        config=types.GenerateContentConfig(temperature=0.7)
    )

    reply = ""
    for chunk in stream:
        if chunk.text:
            reply += chunk.text

    st.session_state.history.append(types.Content(
        role="model",
        parts=[types.Part.from_text(text=reply)]
    ))

    return reply


# -------------------- UI --------------------
st.set_page_config(page_title="Gemma AI", page_icon="🤖", layout="wide")

st.markdown("""
<style>
.stChatMessage {
    border-radius: 12px;
    padding: 10px;
}
</style>
""", unsafe_allow_html=True)

st.title("🤖 Gemma AI Chatbot")

# Display chat history
for msg in st.session_state.messages:
    with st.chat_message(msg["role"]):
        st.markdown(msg["content"])

# Input
if prompt := st.chat_input("Type your message..."):

    # Show user message
    st.session_state.messages.append({"role": "user", "content": prompt})
    with st.chat_message("user"):
        st.markdown(prompt)

    # Generate response
    with st.chat_message("assistant"):
        placeholder = st.empty()
        full_response = ""

        response = chat(prompt)

        # Streaming effect
        for word in response.split():
            full_response += word + " "
            placeholder.markdown(full_response)

    st.session_state.messages.append({
        "role": "assistant",
        "content": full_response
    })