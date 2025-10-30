const express = require('express');
const mysql = require('mysql2');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const Papa = require('papaparse');
const XLSX = require('xlsx');
const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(cors());

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/'); 
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname); 
  }
});

const upload = multer({ 
  storage: storage, 
  fileFilter: (req, file, cb) => {
    const allowedTypes = /csv|xlsx|xls/;
    const ext = file.originalname.split('.').pop().toLowerCase();
    if (allowedTypes.test(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed!'), false);
    }
  }
}).single('dataset');

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const db = mysql.createConnection({
  host: 'localhost',
  user: 'root',
  password: 'password',
  database: 'demo_schema'
});

db.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    setTimeout(() => db.connect(), 2000);
    return;
  }
  console.log('Connected to MySQL database');
});

db.on('error', (err) => {
  console.error('Database error:', err);
  if (err.code === 'PROTOCOL_CONNECTION_LOST') {
    db.connect();
  }
});

app.get('/api/data', (req, res) => {
  db.query('SELECT * FROM login', (err, results) => {
    if (err) {
      console.error('Query error:', err);
      res.status(500).json({ error: 'Server error' });
      return;
    }
    res.json(results);
  });
});


app.post('/api/signup', (req, res) => {
  const { name, email, mobile, password } = req.body;

  if (!name || !email || !mobile || !password) {
    return res.status(400).json({ error: 'All fields are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (!/^[0-9]{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Mobile number must be 10 digits' });
  }
  if (!/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/.test(password)) {
    return res.status(400).json({ error: 'Password must be at least 8 characters with 1 letter and 1 number' });
  }

  const query = 'INSERT INTO login (name, email, mobile, password) VALUES (?, ?, ?, ?)';
  db.query(query, [name, email, mobile, password], (err, result) => {
    if (err) {
      console.error('Insert error:', err);
      if (err.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ error: 'Email already exists' });
      }
      return res.status(500).json({ error: 'Server error' });
    }
    res.json({ message: 'Sign-up successful', id: result.insertId });
  });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }

  const query = 'SELECT * FROM login WHERE email = ? AND password = ?';
  db.query(query, [email, password], (err, results) => {
    if (err) {
      console.error('Login query error:', err);
      return res.status(500).json({ error: 'Server error' });
    }
    if (results.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    res.json({ message: 'Login successful', user: results[0] });
  });
});

app.post('/api/upload', (req, res, next) => {
  upload(req, res, (err) => {
    if (err) {
      console.error('Upload error:', err);
      return res.status(400).json({ error: err.message });
    }
    if (!req.file && !req.body.dataset) {
      return res.status(400).json({ error: 'No file or dataset reference provided' });
    }
    const targetColumn = req.body.targetColumn;
    const mlModel = req.body.mlModel;
    const trainSize = parseInt(req.body.trainSize);
    const testSize = parseInt(req.body.testSize);
    const filename = req.file ? req.file.filename : req.body.dataset;
    console.log('File processed:', filename, 'Target Column:', targetColumn, 'ML Model:', mlModel, 'Train Size:', trainSize, 'Test Size:', testSize);
    res.status(200).json({ message: 'File processed successfully', filename: filename }); // Explicit 200
  });
});

app.get('/api/eda', (req, res) => {
  const filename = req.query.filename;
  if (!filename) {
    return res.status(400).json({ error: 'No filename provided' });
  }

  const filePath = path.join(__dirname, 'uploads', filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    let data;
    if (filename.endsWith('.csv')) {
      const fileContent = fs.readFileSync(filePath, 'utf8');
      const parsed = Papa.parse(fileContent, { header: true, skipEmptyLines: true });
      data = parsed.data;
    } else if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const workbook = XLSX.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      data = XLSX.utils.sheet_to_json(worksheet);
    } else {
      return res.status(400).json({ error: 'Unsupported file format' });
    }

    if (data.length === 0) {
      return res.status(400).json({ error: 'Empty dataset' });
    }

    const columns = Object.keys(data[0]);
    const shape = { rows: data.length, cols: columns.length };

    // Dataset info (simulated data types)
    const info = `Dataset Info:\nRows: ${shape.rows}\nColumns: ${shape.cols}\n\nData Types:\n${columns.map(col => `${col}: object (${data.filter(row => row[col] !== undefined && row[col] !== null).length} non-null)`).join('\n')}`;

    // Head (first 5 rows)
    const headData = data.slice(0, 5);
    const head = `First 5 Rows:\n${JSON.stringify(headData, null, 2)}`;

    // Missing values
    const nullValues = {};
    columns.forEach(col => {
      nullValues[col] = data.filter(row => row[col] === null || row[col] === undefined).length;
    });
    const nullValuesStr = `Missing Values:\n${Object.entries(nullValues).map(([col, count]) => `${col}: ${count}`).join('\n')}`;

    // Simulated correlation matrix (simple Pearson correlation)
    const correlation = {};
    columns.forEach(col1 => {
      correlation[col1] = {};
      columns.forEach(col2 => {
        if (col1 === col2) {
          correlation[col1][col2] = 1.0;
        } else {
          // Simple correlation simulation (replace with actual calculation)
          const values1 = data.map(row => row[col1]).filter(v => v !== null && v !== undefined);
          const values2 = data.map(row => row[col2]).filter(v => v !== null && v !== undefined);
          correlation[col1][col2] = Math.random() * 0.8 + 0.1; // Simulated values between 0.1 and 0.9
        }
      });
    });

    // Simulated feature importance (based on random weights)
    const featureImportance = {};
    columns.forEach(col => {
      featureImportance[col] = Math.random(); // Simulated importance between 0 and 1
    });
    const featureImportanceStr = `Feature Importance:\n${Object.entries(featureImportance).map(([col, imp]) => `${col}: ${imp.toFixed(3)}`).sort((a, b) => b[1] - a[1]).join('\n')}`;

    res.json({
      shape,
      info,
      head,
      null_values: nullValuesStr,
      correlation: Object.values(correlation).flat(),
      feature_importance: featureImportanceStr
    });

  } catch (error) {
    console.error('EDA error:', error);
    res.status(500).json({ error: 'Failed to process dataset for EDA' });
  }
});


const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});