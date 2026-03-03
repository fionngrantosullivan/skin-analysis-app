import React, { useState } from 'react';
import axios from 'axios';
import './App.css';

// five colors going from dark teal to very light, used to visually distinguish bars in the chart
// index 0 being the most confident (darkest) prediction
const BAR_COLORS = [
  { bg: 'rgba(0, 137, 123, 0.85)', border: 'rgb(0, 105, 92)' },
  { bg: 'rgba(38, 166, 154, 0.75)', border: 'rgb(0, 137, 123)' },
  { bg: 'rgba(77, 182, 172, 0.65)', border: 'rgb(38, 166, 154)' },
  { bg: 'rgba(128, 203, 196, 0.55)', border: 'rgb(77, 182, 172)' },
  { bg: 'rgba(178, 223, 219, 0.50)', border: 'rgb(128, 203, 196)' },
];

// this is its own separate component rather than being inline in App() to be cleaner
function ResultsChart({ predictions }) {
  // if the bar is too short (under 12%), the percentage text won't fit inside it,
  // so we render the label outside the bar instead to avoid overlap
  const isSmallBar = (confidence) => confidence < 12;
  
  return (
    <div className="chart-section">
      <h3>Confidence Levels Graph</h3>
      <div className="css-chart">
        {predictions.map((pred, index) => (
          <div key={index} className="chart-row">
            {/* truncate long class names so the label column doesn't get enormous,
                22 chars is roughly the point where things start overflowing */}
            <div className="chart-label" title={pred.class_name}>
              {pred.class_name.length > 22 
                ? pred.class_name.substring(0, 22) + '...' 
                : pred.class_name}
            </div>
            <div className="chart-bar-wrapper">
              {/* Math.max(..., 0.5) prevents a 0% bar from being completely invisible,
                  even at 0 confidence you still see a tiny sliver so the row doesn't look broken */}
              <div 
                className={`chart-bar ${isSmallBar(pred.confidence) ? 'small-bar' : ''}`}
                style={{ 
                  width: `${Math.max(pred.confidence, 0.5)}%`,
                  backgroundColor: BAR_COLORS[index]?.bg || BAR_COLORS[4].bg,
                  borderColor: BAR_COLORS[index]?.border || BAR_COLORS[4].border,
                }}
              >
                {/* only render the label inside the bar if there's actually room for it */}
                {!isSmallBar(pred.confidence) && (
                  <span className="chart-bar-value">{pred.confidence}%</span>
                )}
              </div>
              {/* for small bars, position the label just to the right of where the bar ends
                  using calc() so it floats outside cleanly */}
              {isSmallBar(pred.confidence) && (
                <span 
                  className="chart-bar-value-outside"
                  style={{ left: `calc(${Math.max(pred.confidence, 0.5)}% + 6px)` }}
                >
                  {pred.confidence}%
                </span>
              )}
            </div>
          </div>
        ))}
        {/* static axis labels at the bottom for visual reference points */}
        <div className="chart-axis">
          <span>0%</span>
          <span>25%</span>
          <span>50%</span>
          <span>75%</span>
          <span>100%</span>
        </div>
      </div>
    </div>
  );
}

// I'll change this when deploying to a new server
const API_URL = 'http://localhost:8000';

// class names from the dataset
const CLASS_NAMES = [
  'Acne and Rosacea Photos',
  'Actinic Keratosis Basal Cell Carcinoma and other Malignant Lesions',
  'Atopic Dermatitis Photos',
  'Bullous Disease Photos',
  'Cellulitis Impetigo and other Bacterial Infections',
  'Eczema Photos',
  'Exanthems and Drug Eruptions',
  'Hair Loss Photos Alopecia and other Hair Diseases',
  'Herpes HPV and other STDs Photos',
  'Light Diseases and Disorders of Pigmentation',
  'Lupus and other Connective Tissue diseases',
  'Melanoma Skin Cancer Nevi and Moles',
  'Nail Fungus and other Nail Disease',
  'Poison Ivy Photos and other Contact Dermatitis',
  'Psoriasis pictures Lichen Planus and related diseases',
  'Scabies Lyme Disease and other Infestations and Bites',
  'Seborrheic Keratoses and other Benign Tumors',
  'Squamous_Cell_Carcinoma',
  'Systemic Disease',
  'Tinea Ringworm Candidiasis and other Fungal Infections',
  'Urticaria Hives',
  'Vascular Tumors',
  'Vasculitis Photos',
  'Warts Molluscum and other Viral Infections'
];

function App() {
  // selectedFile is the actual File object from the browser, which is needed for FormData when posting to the API
  const [selectedFile, setSelectedFile] = useState(null);

  // preview is a base64 data URL just for showing the image in the UI before submission to the model
  // generated client-side via FileReader
  const [preview, setPreview] = useState(null);

  // predictions holds the full response object from /predict, including top_prediction
  // and a ranked predictions array
  const [predictions, setPredictions] = useState(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // gradcamImages is an object keyed by prediction index (0–4), so heatmaps can be cached
  // and re-requesting them from the backend every time the user clicks a different condition is avoided
  const [gradcamImages, setGradcamImages] = useState({});

  // tracks which prediction's Grad-CAM is currently being shown in the visualisation panel
  const [activeGradcamIndex, setActiveGradcamIndex] = useState(0);

  const [loadingGradcam, setLoadingGradcam] = useState(false);

  // controls whether the collapsible "all detectable conditions" list is open or closed
  const [showClasses, setShowClasses] = useState(false);

  // controls whether the Grad-CAM explanation box is expanded
  const [showGradcamInfo, setShowGradcamInfo] = useState(false);

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);

      // wipe any previous results when a new file is picked
      // stale predictions from a previous image showing alongside a new preview would be confusing
      setPredictions(null);
      setError(null);
      setGradcamImages({});
      setActiveGradcamIndex(0);
      
      // FileReader lets us generate a local preview URL entirely in the browser
      // readAsDataURL gives back a base64 string we can drop straight into an <img> src
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async (e) => {
    // prevent the default browser form submission which would cause a page reload
    e.preventDefault();
    
    if (!selectedFile) {
      setError('Please select an image first');
      return;
    }

    setLoading(true);
    setError(null);
    setPredictions(null);
    setGradcamImages({});
    setActiveGradcamIndex(0);

    // FormData packages the file upload for a multipart/form-data
    // the backend expects the file under the key 'file'
    const formData = new FormData();
    formData.append('file', selectedFile);

    try {
      const response = await axios.post(`${API_URL}/predict`, formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      setPredictions(response.data);
      
      // kick off the Grad-CAM request for the top prediction straight away so the user doesn't have to click anything to see the heatmap
      if (response.data.predictions && response.data.predictions.length > 0) {
        loadGradcam(0);
      }
    } catch (err) {
      // err.response?.data?.detail pulls the FastAPI HTTPException message if the server returned one
      // otherwise fall back to a generic "is your backend running?" message
      setError(
        err.response?.data?.detail || 
        'Failed to process image. Please make sure the backend is running.'
      );
    } finally {
      setLoading(false);
    }
  };

  const loadGradcam = async (index) => {
    if (!selectedFile || !predictions || !predictions.predictions[index]) {
      return;
    }

    // cache check if we've already fetched this heatmap
    // just switches to it rather than calling the backend again
    if (gradcamImages[index]) {
      setActiveGradcamIndex(index);
      return;
    }

    setLoadingGradcam(true);
    setActiveGradcamIndex(index);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      
      // the backend needs a numeric class index, not the class name string,
      // it can be looked up from the CLASS_NAMES array this is why they must stay in sync (I should change this soon)
      const classIndex = CLASS_NAMES.indexOf(predictions.predictions[index].class_name);
      
      const response = await axios.post(
        `${API_URL}/gradcam?class_index=${classIndex}`,
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      setGradcamImages(prev => ({
        ...prev,  // spread existing cached heatmaps so we don't lose them
        [index]: {
          heatmap: `data:image/png;base64,${response.data.heatmap}`,
          original: `data:image/png;base64,${response.data.original}`,
          class_name: response.data.class_name
        }
      }));
    } catch (err) {
      console.error('Error loading Grad-CAM:', err);
      setError('Failed to load Grad-CAM visualisation');
    } finally {
      setLoadingGradcam(false);
    }
  };

  // full reset back to a clean slate
  const handleReset = () => {
    setSelectedFile(null);
    setPreview(null);
    setPredictions(null);
    setError(null);
    setGradcamImages({});
    setActiveGradcamIndex(0);
  };

  return (
    <div className="App">
      <div className="container">
        <header className="header">
          <h1>Dermatological Analysis System</h1>
          <p>AI-Powered Skin Condition Classification with Explainability</p>
        </header>

        {/* disclaimer rendered unconditionally at the top of every page load */}
        <div className="disclaimer-banner">
          <div className="disclaimer-icon">!</div>
          <div className="disclaimer-content">
            <strong>Medical Disclaimer</strong>
            <p>
              This tool is for <b>educational and informational purposes only</b>. 
              It is NOT a substitute for professional medical advice, diagnosis, or treatment. 
              Always seek the advice of a healthcare professional with any questions 
              regarding a medical condition you may have. Never disregard professional medical advice or 
              delay seeking it as a result of this tool's output.
            </p>
          </div>
        </div>

        <div className="main-content">
          {/* collapsible section, hidden by default since 24 class names would dominate
              the page, but useful for users who want to know what the model can detect */}
          <div className="classes-section">
            <button 
              className="classes-toggle"
              onClick={() => setShowClasses(!showClasses)}
            >
              <span className="toggle-icon">{showClasses ? '▼' : '▶'}</span>
              View All Detectable Conditions ({CLASS_NAMES.length} categories)
            </button>
            {showClasses && (
              <div className="classes-grid">
                {CLASS_NAMES.map((className, index) => (
                  <div key={index} className="class-tag">
                    {/* replace underscores with spaces for display for some class names */}
                    {className.replace(/_/g, ' ')}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="upload-section">
            <form onSubmit={handleSubmit} className="upload-form">
              {/* the actual <input> is hidden and the visible button is a styled <label> pointing to it via htmlFor */}
              <div className="file-input-wrapper">
                <input
                  type="file"
                  id="file-input"
                  accept="image/*"
                  onChange={handleFileSelect}
                  className="file-input"
                />
                <label htmlFor="file-input" className="file-label">
                  {selectedFile ? selectedFile.name : 'Select Image File'}
                </label>
              </div>

              {/* only render the preview once a file has been selected,
                  preview state is set by the FileReader callback in handleFileSelect */}
              {preview && (
                <div className="preview-container">
                  <img src={preview} alt="Preview" className="preview-image" />
                </div>
              )}

              <div className="button-group">
                <button
                  type="submit"
                  // disabled while no file is selected or while a request is in progress to prevent double submissions
                  disabled={!selectedFile || loading}
                  className="submit-button"
                >
                  {loading ? 'Analysing...' : 'Analyse Image'}
                </button>
                {/* reset button only appears once a file is selected */}
                {selectedFile && (
                  <button
                    type="button"
                    onClick={handleReset}
                    className="reset-button"
                  >
                    Reset
                  </button>
                )}
              </div>
            </form>
          </div>

          {error && (
            <div className="error-message">
              <p>{error}</p>
            </div>
          )}

          {/* nothing renders in results section until the /predict call succeeds */}
          {predictions && (
            <div className="results-section">
              <h2>Analysis Results</h2>
              
              {/* softmax explanation, helps users understand why the percentages sum to 100 
                  and what "confidence" actually means here */}
              <div className="info-box confidence-info">
                <div className="info-header">
                  <span className="info-icon">i</span>
                  <strong>Understanding Confidence Scores</strong>
                </div>
                <p>
                  The <b>confidence percentage</b> represents how certain the AI model 
                  is in its predictions. It's calculated using a <em>softmax function</em>, which 
                  converts the model's raw outputs into probabilities that sum to 100% across all 
                  possible class (the 24 skin diseases in this case). A higher percentage indicates the model 
                  found more features in your image that match that particular condition. For example, 85% 
                  confidence means the model is quite confident the condition belongs to that disease, while 
                  30% suggests uncertainty, and that the other conditions within the results should be 
                  considered more strongly.
                </p>
              </div>

              {/* top prediction gets its own prominent card separate from the others, and
                  clicking it also triggers a Grad-CAM load for index 0 */}
              <div className="top-prediction">
                <h3>Most Likely Condition</h3>
                <div 
                  className={`prediction-card primary ${activeGradcamIndex === 0 ? 'active' : ''}`}
                  onClick={() => loadGradcam(0)}
                >
                  <div className="prediction-name">
                    {predictions.top_prediction.class_name}
                  </div>
                  <div className="confidence-row">
                    <div className="confidence-bar-container primary-bar">
                      <div 
                        className="confidence-bar" 
                        style={{ width: `${predictions.top_prediction.confidence}%` }}
                      ></div>
                    </div>
                    <span className="confidence-text-outside">
                      {predictions.top_prediction.confidence}%
                    </span>
                  </div>
                </div>
              </div>

              {/* slice(1, 5) takes predictions 2–5, skipping index 0 which is already
                  shown in the top prediction block above */}
              <div className="other-predictions">
                <h3>Other Possible Conditions</h3>
                <div className="predictions-grid">
                  {predictions.predictions.slice(1, 5).map((pred, index) => (
                    <div 
                      key={index + 1} 
                      // index + 1 because this maps to prediction rank 2–5, not 1–4
                      className={`prediction-card ${activeGradcamIndex === index + 1 ? 'active' : ''}`}
                      onClick={() => loadGradcam(index + 1)}
                    >
                      <div className="prediction-rank">#{index + 2}</div>
                      <div className="prediction-name">{pred.class_name}</div>
                      <div className="confidence-bar-container small">
                        <div 
                          className="confidence-bar" 
                          style={{ width: `${pred.confidence}%` }}
                        ></div>
                        <span className="confidence-text">
                          {pred.confidence}%
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <ResultsChart predictions={predictions.predictions.slice(0, 5)} />

              {/* Grad-CAM section, only renders if there are predictions to visualise */}
              {predictions.predictions && predictions.predictions.length > 0 && (
                <div className="gradcam-section">
                  <div className="gradcam-header">
                    <h3>Grad-CAM Explainability Visualisation</h3>
                    {/* toggling this shows/hides the explanation of how Grad-CAM works, collapsed by default */}
                    <button 
                      className="info-toggle"
                      onClick={() => setShowGradcamInfo(!showGradcamInfo)}
                    >
                      {showGradcamInfo ? 'Hide' : 'What is Grad-CAM?'}
                    </button>
                  </div>
                  
                  {/* explanation box for GradCAM */}
                  {showGradcamInfo && (
                    <div className="info-box gradcam-info">
                      <div className="info-header">
                        <span className="info-icon search-icon">?</span>
                        <strong>How Grad-CAM Works</strong>
                      </div>
                      <p>
                        <strong>Grad-CAM (Gradient-weighted Class Activation Mapping)</strong> is 
                        an explainability technique which helps visualise the <em>specific parts of an image </em>
                        that the model focuses on the most when making a prediction.
                      </p>
                      <div className="gradcam-steps">
                        <div className="step">
                          <span className="step-num">1</span>
                          <span>The model processes the image through its neural network layers</span>
                        </div>
                        <div className="step">
                          <span className="step-num">2</span>
                          <span>Gradients (measures of importance) are computed for the predicted class (i.e. the predicted skin disease in this case)</span>
                        </div>
                        <div className="step">
                          <span className="step-num">3</span>
                          <span>These gradients highlight which image regions influenced the prediction the most</span>
                        </div>
                        <div className="step">
                          <span className="step-num">4</span>
                          <span>A heatmap is generated: <span className="color-hot">warm colors (red/yellow)</span> = high importance, <span className="color-cold">cool colors (blue/green)</span> = low importance</span>
                        </div>
                      </div>
                      <p>
                        <em>This transparency helps you understand the model's reasoning and verify 
                        it's focusing on relevant skin features rather than background artifacts.</em>
                      </p>
                    </div>
                  )}
                  
                  <p className="gradcam-label">
                    Click a condition above or select below to view its attention heatmap
                  </p>
                  
                  {/* one button per top-5 prediction, clicking fetches (or retrieves from cache)
                      the heatmap for that specific class index */}
                  <div className="gradcam-controls">
                    {predictions.predictions.slice(0, 5).map((pred, index) => (
                      <button
                        key={index}
                        className={`gradcam-button ${activeGradcamIndex === index ? 'active' : ''}`}
                        onClick={() => loadGradcam(index)}
                        // disable all buttons while a heatmap is loading to prevent concurrent requests from racing each other
                        disabled={loadingGradcam}
                      >
                        #{index + 1}: {pred.class_name.length > 25 
                          ? pred.class_name.substring(0, 25) + '...' 
                          : pred.class_name}
                      </button>
                    ))}
                  </div>

                  {/* spinner shown while waiting for the /gradcam response, Grad-CAM can take 
                      a second or two since it's running a backward pass */}
                  {loadingGradcam && (
                    <div className="gradcam-loading">
                      <div className="loading-spinner"></div>
                      Generating heatmap visualisation...
                    </div>
                  )}

                  {/* only render the image once loading is done and the heatmap exists in cache */}
                  {!loadingGradcam && gradcamImages[activeGradcamIndex] && (
                    <div className="gradcam-visualisation">
                      <p className="gradcam-label">
                        Heatmap for: <strong>{gradcamImages[activeGradcamIndex].class_name}</strong>
                      </p>
                      {/* the heatmap src is the base64 data URI obtained from loadGradcam */}
                      <img 
                        src={gradcamImages[activeGradcamIndex].heatmap} 
                        alt="Grad-CAM Heatmap" 
                        className="gradcam-image"
                      />
                      {/* color legend so users know what the heatmap colors actually mean */}
                      <p className="heatmap-legend">
                        <span className="legend-item"><span className="legend-hot">■</span> Red/Yellow = Areas the model focused on most</span>
                        <span className="legend-separator">|</span>
                        <span className="legend-item"><span className="legend-cold">■</span> Blue/Green = Areas with less focus</span>
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;