#!/usr/bin/env python3

"""
Test script for Google Cloud Text-to-Speech API
Tests the API key and generates sample audio files
"""

import requests
import json
import base64
import sys
import os

# API Configuration
API_KEY = "AIzaSyDqGMFPOgwrKuVVoGsU53RxwpngdjzoPFo"
BASE_URL = "https://texttospeech.googleapis.com/v1"

def test_tts_api(text="Hello, this is a test of Google Cloud Text-to-Speech", language="en-US", voice="en-US-Neural2-A"):
    """Test the Google Cloud TTS API"""
    
    url = f"{BASE_URL}/text:synthesize?key={API_KEY}"
    
    payload = {
        "input": {"text": text},
        "voice": {
            "languageCode": language,
            "name": voice
        },
        "audioConfig": {
            "audioEncoding": "MP3",
            "speakingRate": 1.0,
            "pitch": 0.0,
            "volumeGainDb": 0.0
        }
    }
    
    headers = {
        "Content-Type": "application/json"
    }
    
    try:
        print(f"🔊 Testing Google Cloud TTS API...")
        print(f"📝 Text: {text}")
        print(f"🗣️  Voice: {voice}")
        print(f"🌍 Language: {language}")
        print()
        
        response = requests.post(url, headers=headers, data=json.dumps(payload))
        
        if response.status_code == 200:
            data = response.json()
            
            if "audioContent" in data:
                # Decode the base64 audio content
                audio_data = base64.b64decode(data["audioContent"])
                
                # Save to file
                output_file = f"tts-test-{voice.replace('.', '-')}.mp3"
                with open(output_file, "wb") as f:
                    f.write(audio_data)
                
                print(f"✅ SUCCESS! Audio saved to: {output_file}")
                print(f"📊 Audio size: {len(audio_data)} bytes")
                return True
            else:
                print(f"❌ Error: No audio content in response")
                print(f"Response: {data}")
                return False
        else:
            print(f"❌ API Error: {response.status_code}")
            try:
                error_data = response.json()
                print(f"Error details: {error_data}")
            except:
                print(f"Response text: {response.text}")
            return False
            
    except Exception as e:
        print(f"❌ Exception: {e}")
        return False

def test_multiple_voices():
    """Test multiple voices"""
    
    test_cases = [
        ("Hello! Welcome to OrderTech Drive-Thru!", "en-US", "en-US-Neural2-A"),
        ("Hello! Welcome to OrderTech Drive-Thru!", "en-US", "en-US-Neural2-D"),
        ("مرحبا! أهلاً بكم في اوردر تك درايف ثرو", "ar-XA", "ar-XA-Wavenet-A"),
        ("Thank you for your order!", "en-US", "en-US-Wavenet-C")
    ]
    
    print("🧪 Testing multiple TTS voices...\n")
    
    success_count = 0
    for i, (text, lang, voice) in enumerate(test_cases, 1):
        print(f"Test {i}/{len(test_cases)}:")
        if test_tts_api(text, lang, voice):
            success_count += 1
        print("-" * 50)
    
    print(f"\n📊 Results: {success_count}/{len(test_cases)} tests passed")
    
    if success_count == len(test_cases):
        print("🎉 All tests passed! Google Cloud TTS is working correctly.")
    else:
        print("⚠️  Some tests failed. Check the error messages above.")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        if sys.argv[1] == "full":
            test_multiple_voices()
        else:
            test_tts_api(sys.argv[1])
    else:
        # Quick test
        if test_tts_api():
            print("\n✅ Basic test passed! Run with 'full' argument for comprehensive testing.")
            print("Usage:")
            print("  python3 test-google-tts.py              # Quick test")
            print("  python3 test-google-tts.py full         # Test multiple voices")
            print("  python3 test-google-tts.py 'Custom text'# Test custom text")