# **Banana Zoom**

> Banana Zoom an advanced image enhancement web app that lets users select regions of an image for AI-powered upscaling and detail refinement. Using Google’s (nano banana), it analyzes selections, generates context-aware enhancements, and produces high-resolution outputs. Simply drag-and-drop or upload images, make precise or fixed-size selections, and watch improvements in real-time with smooth zoom and pixel-dissolve effects. 

| Image | Preview |
|-------|---------|
| enhancement-zoom(1) | ![enhancement-zoom](https://github.com/user-attachments/assets/ef1d5e92-c502-4f0b-a225-0b56a006353b) |
| enhancement-zoom(2) | ![enhancement-zoom(2)](https://github.com/user-attachments/assets/bf3834fe-5136-4e0c-ae8c-8ccc4fbc864e) |
| enhancement-zoom(3) | ![enhancement-zoom(3)](https://github.com/user-attachments/assets/328ee22c-fe03-4a8c-8f27-67a15e844d3d) |
| enhancement-zoom(4) | ![enhancement-zoom(4)](https://github.com/user-attachments/assets/1e4edb8a-c533-49f1-ad6a-b579c9e205eb) |
| enhancement-zoom(5) | ![enhancement-zoom(5)](https://github.com/user-attachments/assets/4e4b341f-0706-43ea-bda8-dbfe13b2b183) |


# Gemini App Proxy Server

This nodejs proxy server lets you run your AI Studio Gemini application unmodified, without exposing your API key in the frontend code.


## Instructions

**Prerequisites**:
- [Google Cloud SDK / gcloud CLI](https://cloud.google.com/sdk/docs/install)
- (Optional) Gemini API Key

1. Download or copy the files of your AI Studio app into this directory at the root level.
2. If your app calls the Gemini API, create a Secret for your API key:
     ```
     echo -n "${GEMINI_API_KEY}" | gcloud secrets create gemini_api_key --data-file=-
     ```

3.  Deploy to Cloud Run (optionally including API key):
    ```
    gcloud run deploy my-app --source=. --update-secrets=GEMINI_API_KEY=gemini_api_key:latest
    ```
