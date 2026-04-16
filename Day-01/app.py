import io
import joblib
import streamlit as st
import pandas as pd
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, accuracy_score


# --- User-provided styling injected into the Streamlit app ---
def build_custom_css(theme: str = "dark") -> str:
        # Base CSS (fonts + utilities)
        base = '''
@import "@fontsource/geist-sans/400.css";
@import "@fontsource/geist-sans/500.css";
@import "@fontsource/geist-sans/600.css";
@import "@fontsource/geist-sans/700.css";

/* shared utilities */
.liquid-glass { background: rgba(255,255,255,0.02); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); border-radius: 12px; }
.hero-gradient-text { background: linear-gradient(223deg, #e8e8e9 0%, #3a7bbf 104%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
button.stButton>button { padding: 8px 18px; border-radius: 10px; font-weight: 600; }
button.stButton>button.primary { background: linear-gradient(90deg,#6b46c1,#3a7bbf); color: #fff; }
'''

        if theme == "light":
                theme_vars = '''
body { font-family: "Geist Sans", Inter, system-ui, sans-serif; background: #f6f7fb; color: #0f172a; }
.liquid-glass { background: rgba(255,255,255,0.6); box-shadow: 0 6px 18px rgba(13, 17, 23, 0.08); }
'''
        elif theme == "professional":
            theme_vars = '''
    body { font-family: "Geist Sans", Inter, system-ui, sans-serif; background: linear-gradient(180deg,#0f172a 0%, #0b1220 100%); color: #e6eef8; }
    .container { max-width: 1100px; margin: 20px auto; padding: 20px; }
    .navbar { display:flex; align-items:center; justify-content:space-between; padding:16px 20px; background: linear-gradient(90deg,#0f172a,#071028); border-radius:12px; box-shadow: 0 6px 18px rgba(2,6,23,0.6); margin-bottom:18px; }
    .navbar .brand { font-size:20px; font-weight:700; letter-spacing:0.4px; }
    .card { background: rgba(255,255,255,0.02); padding:16px; border-radius:12px; box-shadow: 0 6px 18px rgba(2,6,23,0.5); }
    .muted { color: rgba(230,238,248,0.7); }
    .metric { font-size:20px; font-weight:700; color:#dbeafe; }
    .small { font-size:13px; color: rgba(230,238,248,0.6); }
    .hero-gradient-text { background: linear-gradient(90deg,#9b7bd6,#3a7bbf); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .liquid-glass { background: linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01)); }
    button.stButton>button { padding: 10px 20px; border-radius: 10px; font-weight: 700; }
    button.stButton>button.primary { background: linear-gradient(90deg,#6b46c1,#3a7bbf); color: #fff; border: none; }
    table.dataframe { background: transparent; color: #e6eef8; }
    '''
        else:
            theme_vars = '''
    body { font-family: "Geist Sans", Inter, system-ui, sans-serif; background: hsl(260,87%,3%); color: hsl(40,6%,95%); }
    .liquid-glass { background: rgba(255,255,255,0.03); box-shadow: inset 0 1px 2px rgba(255,255,255,0.03); }
    '''

        return base + theme_vars

# Use sidebar theme toggle to rebuild CSS dynamically
theme_choice = st.sidebar.selectbox("Theme", ["professional", "dark", "light"], index=0)
st.markdown(f"<style>{build_custom_css(theme_choice)}</style>", unsafe_allow_html=True)


def load_data(path):
    texts = []
    labels = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or ";" not in line:
                continue
            text, label = line.rsplit(";", 1)
            texts.append(text.strip())
            labels.append(label.strip())
    return texts, labels


def compute_metrics_from_model(model_obj, X, y_true):
    """Given a loaded joblib model object (with pipeline and label_encoder), compute per-class metrics."""
    pipeline = model_obj.get("pipeline")
    le = model_obj.get("label_encoder")
    if pipeline is None or le is None:
        raise ValueError("Model file missing pipeline or label_encoder")
    y_pred = pipeline.predict(X)
    # if y_true are labels strings, convert to encoded ints using le
    try:
        y_true_enc = le.transform(y_true)
    except Exception:
        # assume y_true already encoded
        y_true_enc = y_true
    report_dict = classification_report(y_true_enc, y_pred, output_dict=True)
    accuracy = accuracy_score(y_true_enc, y_pred)
    # convert report_dict keys that are numeric to label names if possible
    return accuracy, report_dict


def format_report_df(report_dict):
    import pandas as _pd
    rows = []
    for label, metrics in report_dict.items():
        if label in ("accuracy", "macro avg", "weighted avg"):
            continue
        rows.append({
            "label": label,
            "precision": metrics.get("precision", 0.0),
            "recall": metrics.get("recall", 0.0),
            "f1-score": metrics.get("f1-score", 0.0),
            "support": int(metrics.get("support", 0)),
        })
    df = _pd.DataFrame(rows).set_index("label")
    return df


def df_to_colored_html(df):
    """Render a comparison DataFrame as an HTML table with colored delta highlights."""
    # df expected to have numeric columns and a 'delta_f1' column
    def fmt(x):
        if isinstance(x, float):
            return f"{x:.3f}"
        return str(x)

    # start table
    html = ['<div style="overflow:auto"><table style="border-collapse:collapse;width:100%">']
    # header
    html.append('<thead><tr>')
    html.append(''.join([f'<th style="text-align:left;padding:8px;border-bottom:1px solid rgba(0,0,0,0.08)">{col}</th>' for col in df.columns]))
    html.append('</tr></thead>')

    # body
    html.append('<tbody>')
    for idx, row in df.iterrows():
        html.append('<tr>')
        for col in df.columns:
            val = row[col]
            cell = fmt(val)
            style = 'padding:8px;border-bottom:1px solid rgba(255,255,255,0.03);'
            # highlight delta_f1
            if col == 'delta_f1':
                try:
                    v = float(val)
                    if v > 0.001:
                        bg = '#e6ffed'  # light green
                        color = '#0b6623'
                    elif v < -0.001:
                        bg = '#ffecec'  # light red
                        color = '#8b0000'
                    else:
                        bg = 'transparent'
                        color = 'inherit'
                    style += f'background:{bg};color:{color};font-weight:700;text-align:right;'
                except Exception:
                    style += 'text-align:right;'
            else:
                # align numbers to right
                if isinstance(val, (int, float)):
                    style += 'text-align:right;'
            html.append(f'<td style="{style}">{cell}</td>')
        html.append('</tr>')
    html.append('</tbody></table></div>')
    return ''.join(html)


# Top navbar + container for professional layout
st.markdown('<div class="container">', unsafe_allow_html=True)
st.markdown('<div class="navbar"><div class="brand"><span class="hero-gradient-text">Emotion Classifier</span> &nbsp;<span class="small muted">— Train UI</span></div><div class="small muted">Local: 8501</div></div>', unsafe_allow_html=True)

st.markdown('<div class="card">', unsafe_allow_html=True)
st.markdown('<p class="small muted">Train and evaluate an emotion classifier interactively.</p>', unsafe_allow_html=True)
st.markdown("Upload or point to a `train.txt` file formatted as `text;label` per line.")

input_path = st.text_input("Training file path", value="train.txt")

if st.button("Load data"):
    texts, labels = load_data(input_path)
    if not texts:
        st.error("No data found — check file path and format.")
    else:
        st.success(f"Loaded {len(texts)} examples")

        # Small info card using the liquid-glass utility
        unique_labels = sorted(set(labels))
        labels_html = ", ".join(unique_labels)
        st.markdown(f'<div class="liquid-glass" style="padding:12px;border-radius:12px;margin-top:8px">'
                    f'<strong>Examples:</strong> {len(texts)} &nbsp; '
                    f'<strong>Labels:</strong> {labels_html}</div>', unsafe_allow_html=True)

        st.dataframe({"text": texts[:200], "label": labels[:200]})

        # Show class distribution chart
        try:
            df_counts = pd.Series(labels).value_counts().rename_axis('label').reset_index(name='count')
            df_counts = df_counts.set_index('label')
            st.bar_chart(df_counts)
        except Exception:
            pass

        # close card container
        st.markdown('</div>', unsafe_allow_html=True)

st.sidebar.header("Training options")
test_size = st.sidebar.slider("Test size", 0.05, 0.5, 0.2, 0.05)
max_features = st.sidebar.number_input("Tfidf max_features", min_value=100, max_value=50000, value=20000, step=100)
ngram_choice = st.sidebar.selectbox("N-gram range", options=["1,1", "1,2"], index=1)
ngram_range = (1, 1) if ngram_choice == "1,1" else (1, 2)
clf_C = st.sidebar.number_input("Logistic C", min_value=0.01, max_value=100.0, value=1.0, step=0.01)
model_path = st.sidebar.text_input("Save model path", value="model.joblib")

if st.button("Train model"):
    with st.spinner("Loading data..."):
        X, y = load_data(input_path)
    if not X:
        st.error("No data to train — load a valid file first.")
    else:
        le = LabelEncoder()
        y_enc = le.fit_transform(y)

        strat = y_enc if len(set(y_enc)) > 1 else None
        X_train, X_test, y_train, y_test = train_test_split(
            X, y_enc, test_size=test_size, random_state=42, stratify=strat
        )

        pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(max_features=int(max_features), ngram_range=ngram_range)),
            ("clf", LogisticRegression(C=float(clf_C), max_iter=1000)),
        ])

        # show progress during training
        prog = st.progress(0)
        prog.progress(10)
        with st.spinner("Training..."):
            pipeline.fit(X_train, y_train)
        prog.progress(80)

        y_pred = pipeline.predict(X_test)
        acc = accuracy_score(y_test, y_pred)
        report = classification_report(y_test, y_pred, target_names=le.classes_)

        st.success(f"Training finished — Accuracy: {acc:.4f}")
        st.text(report)

        # Styled accuracy card inside container
        st.markdown('<div class="card" style="margin-top:12px">', unsafe_allow_html=True)
        st.markdown(f'<div style="display:flex;gap:18px;align-items:center"><div class="metric">{acc:.4f}</div><div class="small muted">Validation Accuracy</div></div>', unsafe_allow_html=True)
        st.markdown('<div style="margin-top:8px" class="small muted">Per-class metrics shown above.</div>', unsafe_allow_html=True)
        st.markdown('</div>', unsafe_allow_html=True)

        # save model to disk
        # save model plus metrics for later comparison
        metrics_obj = {"accuracy": float(acc), "report": classification_report(y_test, y_pred, target_names=le.classes_, output_dict=True)}
        joblib.dump({"pipeline": pipeline, "label_encoder": le, "metrics": metrics_obj}, model_path)
        prog.progress(100)
        st.success(f"Saved model to {model_path}")

        st.markdown(f'<div class="card" style="margin-top:10px;padding:10px">Model saved: {model_path}</div>', unsafe_allow_html=True)

        # finalize container wrapper
        st.markdown('</div>', unsafe_allow_html=True)

        # provide download
        try:
            with open(model_path, "rb") as f:
                data = f.read()
            st.download_button("Download model", data, file_name=model_path)
        except Exception:
            st.info("Model saved to disk; download not available in this environment.")


    # ------------------ Compare / Diff UI ------------------
    with st.expander("Compare Models / Diff", expanded=False):
        st.markdown("Upload two saved model files (joblib) and a test data file to compare metrics.")
        model_a = st.file_uploader("Model A (joblib)", type=["joblib"], key="mA")
        model_b = st.file_uploader("Model B (joblib)", type=["joblib"], key="mB")
        diff_test_path = st.text_input("Test data path (text;label per line)", value="train.txt", key="diff_test")
        if st.button("Compare", key="compare_btn"):
            if model_a is None or model_b is None:
                st.error("Please upload both model files to compare.")
            else:
                try:
                    obj_a = joblib.load(model_a)
                    obj_b = joblib.load(model_b)
                except Exception as e:
                    st.error(f"Failed to load model files: {e}")
                    obj_a = obj_b = None

                if obj_a and obj_b:
                    X_test_texts, y_test = load_data(diff_test_path)
                    if not X_test_texts:
                        st.error("No test data loaded from path.")
                    else:
                        # compute metrics
                        acc_a, rep_a = compute_metrics_from_model(obj_a, X_test_texts, y_test)
                        acc_b, rep_b = compute_metrics_from_model(obj_b, X_test_texts, y_test)
                        df_a = format_report_df(rep_a)
                        df_b = format_report_df(rep_b)

                        # align labels
                        labels = sorted(set(df_a.index).union(df_b.index))
                        df_a = df_a.reindex(labels).fillna(0)
                        df_b = df_b.reindex(labels).fillna(0)

                        diff = df_b["f1-score"] - df_a["f1-score"]
                        summary = df_a.copy()
                        summary.columns = [f"A_{c}" for c in summary.columns]
                        summary = summary.join(df_b.add_prefix("B_"))
                        summary["delta_f1"] = diff

                        st.markdown("**Accuracy**")
                        st.write(f"Model A: {acc_a:.4f} — Model B: {acc_b:.4f} — Delta: {acc_b-acc_a:+.4f}")

                        st.markdown("**Per-class comparison (A vs B)**")
                        # render colored diff table
                        try:
                            html = df_to_colored_html(summary)
                            st.markdown(html, unsafe_allow_html=True)
                        except Exception:
                            st.dataframe(summary)

                        # highlight improvements
                        improved = summary[summary["delta_f1"] > 0].shape[0]
                        worsened = summary[summary["delta_f1"] < 0].shape[0]
                        st.markdown(f"Improved classes: {improved} — Worsened classes: {worsened}")
