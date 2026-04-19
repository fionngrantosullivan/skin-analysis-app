# FastAPI
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# PyTorch
import torch
import torch.nn as nn
import torch.nn.functional as F
from torchvision import models, transforms

# image-related stuff + utilities
from PIL import Image
import io
import uvicorn
import numpy as np
import cv2
import base64

# GradCAM
from pytorch_grad_cam import GradCAM
from pytorch_grad_cam.utils.model_targets import ClassifierOutputTarget
from pytorch_grad_cam.utils.image import show_cam_on_image

# Static file serving for deployed frontend
from fastapi.staticfiles import StaticFiles

app = FastAPI(title="Skin Condition Classifier API")

# CORS middleware to allow React frontend to access the API
app.add_middleware(
    CORSMiddleware,
    # allow React app from localhost and any LAN IP (e.g. when opened on mobile)
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# get model weights for loading it in
import os

# get model filepath and 
MODEL_PATH = os.environ.get("MODEL_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "models", "aggregated_efficientnet_b3.pth"))
DEVICE = torch.device("cuda" if torch.cuda.is_available() else "cpu")
NUM_CLASSES = 24

# disease class names from model notebook
CLASS_NAMES = [
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
]

# preprocessing for the input image
transform = transforms.Compose([
    transforms.Resize((300, 300)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406],
                         [0.229, 0.224, 0.225])
])

model = None
gradcam = None

def load_model():
    global model, gradcam
    try:
        model = models.efficientnet_b3(weights=None)

        # replace classifier head
        in_features = model.classifier[1].in_features
        model.classifier[1] = nn.Linear(in_features, NUM_CLASSES)
        model.load_state_dict(torch.load(MODEL_PATH, map_location=DEVICE))
        model.to(DEVICE)
        model.eval()
        
        # initialise Grad-CAM
        target_layers = [model.features[-1]]
        gradcam = GradCAM(model=model, target_layers=target_layers)
        
        print(f"Model loaded successfully on {DEVICE}")
        print("Grad-CAM initialized")
    except Exception as e:
        print(f"Error loading model: {e}")
        raise

@app.on_event("startup")
async def startup_event():
    # load model on startup
    load_model()

@app.post("/predict")
async def predict(file: UploadFile = File(...)):
    # check if model isn't loaded - 500 if so
    if model is None:
        raise HTTPException(status_code=500, detail="Model not loaded")
    
    # validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        # read image file
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        
        # preprocess image
        image_tensor = transform(image).unsqueeze(0).to(DEVICE)
        
        # run inference
        with torch.no_grad():
            outputs = model(image_tensor)
            probabilities = torch.nn.functional.softmax(outputs[0], dim=0)
            
        # get top 5 predictions
        top5_probs, top5_indices = torch.topk(probabilities, min(5, len(CLASS_NAMES)))
        
        # put results in a list for JSON response body
        results = []
        for prob, idx in zip(top5_probs, top5_indices):
            results.append({
                "class_name": CLASS_NAMES[idx.item()],
                "confidence": round(prob.item() * 100, 2)
            })
        
        # format JSON with both whole predictions list and top prediction contents
        # seemed more convenient that way for reading the JSON
        return JSONResponse(content={
            "predictions": results,
            "top_prediction": results[0]
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {e}")

@app.post("/gradcam")
async def get_gradcam(file: UploadFile = File(...), class_index: int = Query(None)):
    # same as above
    if model is None or gradcam is None:
        raise HTTPException(status_code=500, detail="Model not loaded")
    
    # validate file type
    if not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        # read image file
        contents = await file.read()
        image = Image.open(io.BytesIO(contents)).convert('RGB')
        original_image = image.copy()
        
        # preprocess image
        image_tensor = transform(image).unsqueeze(0).to(DEVICE)
        
        # get prediction if class_index not provided
        if class_index is None:
            with torch.no_grad():
                outputs = model(image_tensor)
                probabilities = torch.nn.functional.softmax(outputs[0], dim=0)
                class_index = probabilities.argmax().item()
        
        # generate Grad-CAM
        targets = [ClassifierOutputTarget(class_index)]
        grayscale_cam = gradcam(input_tensor=image_tensor, targets=targets)
        cam = grayscale_cam[0, :]  # Get first (only) image in batch
        
        # resize original image to match model input size
        img_resized = original_image.resize((300, 300))
        img_np = np.array(img_resized)
        
        # normalise image to [0, 1] for overlay
        img_np = img_np.astype(np.float32) / 255.0
        
        # resize CAM to match image size
        cam_resized = cv2.resize(cam, (300, 300))
        
        # overlay CAM on image
        visualisation = show_cam_on_image(img_np, cam_resized, use_rgb=True)
        
        # convert to base64
        # necessary for encoding the GradCAM image into the JSON response so the frontend can load it
        pil_image = Image.fromarray(visualisation)
        buffer = io.BytesIO()
        pil_image.save(buffer, format='PNG')
        img_str = base64.b64encode(buffer.getvalue()).decode()
        
        # also encode original image the saem way
        buffer_orig = io.BytesIO()
        img_resized.save(buffer_orig, format='PNG')
        img_orig_str = base64.b64encode(buffer_orig.getvalue()).decode()
        
        return JSONResponse(content={
            "heatmap": img_str,
            "original": img_orig_str,
            "class_index": class_index,
            "class_name": CLASS_NAMES[class_index]
        })
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error generating Grad-CAM: {e}")

# Mount the React build AFTER all API routes so /predict and /gradcam are matched first.
# Starlette matches routes in registration order; a catch-all Mount("/") registered before
# the API routes would intercept POST requests and serve index.html instead.
build_dir = os.path.join(os.path.dirname(__file__), "frontend", "build")
if os.path.exists(build_dir):
    app.mount("/", StaticFiles(directory=build_dir, html=True), name="static")
    print(f"Frontend static files mounted from {build_dir}")
else:
    print(f"Note: Frontend build directory not found at {build_dir}. API-only mode.")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
