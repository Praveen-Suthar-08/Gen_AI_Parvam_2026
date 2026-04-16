#!/usr/bin/env python3
"""Simple training script: loads `train.txt`, trains a TF-IDF + LogisticRegression
pipeline, prints evaluation and saves the model to disk (joblib).
"""
import argparse
import joblib
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import LabelEncoder
from sklearn.metrics import classification_report, accuracy_score


def load_data(path):
    texts = []
    labels = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            if ";" not in line:
                continue
            text, label = line.rsplit(";", 1)
            texts.append(text.strip())
            labels.append(label.strip())
    return texts, labels


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="train.txt", help="Path to input file")
    parser.add_argument("--model", default="model.joblib", help="Output model path")
    parser.add_argument("--test-size", type=float, default=0.2)
    parser.add_argument("--random-state", type=int, default=42)
    args = parser.parse_args()

    X, y = load_data(args.input)
    if not X:
        raise SystemExit(f"No data loaded from {args.input}")

    le = LabelEncoder()
    y_enc = le.fit_transform(y)

    strat = y_enc if len(set(y_enc)) > 1 else None
    X_train, X_test, y_train, y_test = train_test_split(
        X, y_enc, test_size=args.test_size, random_state=args.random_state, stratify=strat
    )

    pipeline = Pipeline(
        [
            ("tfidf", TfidfVectorizer(max_features=20000, ngram_range=(1, 2))),
            ("clf", LogisticRegression(max_iter=1000)),
        ]
    )

    pipeline.fit(X_train, y_train)

    y_pred = pipeline.predict(X_test)
    print("Accuracy:", accuracy_score(y_test, y_pred))
    print(classification_report(y_test, y_pred, target_names=le.classes_))

    joblib.dump({"pipeline": pipeline, "label_encoder": le}, args.model)
    print("Saved model to", args.model)


if __name__ == "__main__":
    main()
