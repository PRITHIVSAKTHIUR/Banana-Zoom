# **Banana Zoom**

> Banana Zoom an advanced image enhancement web app that lets users select regions of an image for AI-powered upscaling and detail refinement. Using Google’s (nano banana), it analyzes selections, generates context-aware enhancements, and produces high-resolution outputs. Simply drag-and-drop or upload images, make precise or fixed-size selections, and watch improvements in real-time with smooth zoom and pixel-dissolve effects. 

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
