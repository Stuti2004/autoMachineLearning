from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
from sklearn.preprocessing import MinMaxScaler
from sklearn.model_selection import train_test_split
from sklearn.linear_model import LinearRegression, LogisticRegression
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor, GradientBoostingRegressor
from sklearn.svm import SVC
import os
import json
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

UPLOAD_FOLDER = 'uploads'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

if not os.path.exists(UPLOAD_FOLDER):
    os.makedirs(UPLOAD_FOLDER)

# Train endpoint
@app.route('/api/train', methods=['POST'])
def train():
    try:
        data = request.get_json()
        filename = data.get('filename')
        target_column = data.get('targetColumn')
        train_features = data.get('trainFeatures')
        normalize = data.get('normalize', False)
        normalize_columns = data.get('normalizeColumns', [])
        train_size = data.get('trainSize', 70) / 100
        test_size = data.get('testSize', 30) / 100
        ml_model = data.get('mlModel')

        if not all([filename, target_column, train_features, ml_model]):
            return jsonify({'error': 'Missing required parameters'}), 400

        file_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not os.path.exists(file_path):
            return jsonify({'error': 'File not found'}), 404

        # Load dataset
        if filename.endswith('.csv'):
            df = pd.read_csv(file_path)
        elif filename.endswith(('.xlsx', '.xls')):
            df = pd.read_excel(file_path)
        else:
            return jsonify({'error': 'Unsupported file format'}), 400

        # Reduce dataset to target and selected features
        df = df[[target_column] + train_features]

        # Handle missing values (simple imputation with mean)
        df = df.fillna(df.mean(numeric_only=True))

        # Normalization
        if normalize and normalize_columns:
            scaler = MinMaxScaler()
            df[normalize_columns] = scaler.fit_transform(df[normalize_columns])

        # Prepare data
        X = df[train_features]
        y = df[target_column]

        # Train-test split
        X_train, X_test, y_train, y_test = train_test_split(X, y, train_size=train_size, test_size=test_size, random_state=42)

        # Select and train model
        model_map = {
            'linear_regression': LinearRegression(),
            'logistic_regression': LogisticRegression(max_iter=1000),
            'random_forest': RandomForestClassifier() if y.dtype == 'object' or y.nunique() > 2 else RandomForestRegressor(),
            'svm': SVC() if y.dtype == 'object' or y.nunique() > 2 else None,  # SVM for classification only
            'gradient_boosting': GradientBoostingRegressor()
        }
        model = model_map.get(ml_model)
        if not model:
            return jsonify({'error': 'Invalid model type'}), 400

        model.fit(X_train, y_train)
        accuracy = model.score(X_test, y_test) if hasattr(model, 'score') else model.score(X_test, y_test)

        return jsonify({
            'status': 'success',
            'model': ml_model.replace('_', ' '),
            'accuracy': accuracy,
            'train_size': train_size * 100,
            'test_size': test_size * 100
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)