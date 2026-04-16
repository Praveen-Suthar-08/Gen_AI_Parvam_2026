# Training the emotion classifier

Files added:
- [train.py](train.py) — training script (reads `train.txt`).
- [requirements.txt](requirements.txt) — Python dependencies.

Quick start:

```bash
python train.py --input train.txt --model model.joblib
```

This will train a TF-IDF + Logistic Regression model, print evaluation,
and save the pipeline plus label encoder to `model.joblib`.

UI option (Streamlit):

```bash
pip install -r requirements.txt
streamlit run app.py
```

Open the local Streamlit URL to load the dataset, configure options, train interactively, and download the model.
