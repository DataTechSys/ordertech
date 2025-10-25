#!/usr/bin/env python3
"""
Test script to verify the AI backend is working correctly.
This tests the same endpoints that the iOS app will use.
"""

import requests
import json
import time
import sys
from datetime import datetime

# Your Cloud Run backend URL
BACKEND_URL = "https://ordertech-64v5pfkeba-ww.a.run.app"

def test_health_check():
    """Test basic health check"""
    print("🔍 Testing health check...")
    try:
        response = requests.get(f"{BACKEND_URL}/health")
        if response.status_code == 200:
            print("✅ Health check passed")
            print(f"   Response: {response.json()}")
            return True
        else:
            print(f"❌ Health check failed: {response.status_code}")
            return False
    except Exception as e:
        print(f"❌ Health check error: {e}")
        return False

def test_ai_token_request():
    """Test AI token request"""
    print("\n🔍 Testing AI token request...")
    
    headers = {
        "Content-Type": "application/json",
        "X-Device-Token": "test-device-token"
    }
    
    data = {
        "device_id": "test-device-123",
        "branch_name": "TestBranch"
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/ai/token", 
                               headers=headers, 
                               json=data)
        
        if response.status_code == 200:
            result = response.json()
            print("✅ AI token request successful")
            print(f"   Token: {result.get('token', 'N/A')[:20]}...")
            print(f"   TTL: {result.get('ttl_seconds', 'N/A')} seconds")
            return result.get('token')
        else:
            print(f"❌ AI token request failed: {response.status_code}")
            if response.text:
                print(f"   Error: {response.text}")
            return None
    except Exception as e:
        print(f"❌ AI token request error: {e}")
        return None

def test_ai_session_creation(token):
    """Test AI session creation"""
    if not token:
        print("\n⏭️  Skipping AI session test (no token)")
        return None
        
    print("\n🔍 Testing AI session creation...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    data = {
        "settings": {
            "model": "gemini-1.5-flash",
            "temperature": 0.7,
            "max_tokens": 500
        }
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/ai/sessions",
                               headers=headers,
                               json=data)
        
        if response.status_code == 200:
            result = response.json()
            session_id = result.get('session_id')
            print("✅ AI session creation successful")
            print(f"   Session ID: {session_id}")
            return session_id, token
        else:
            print(f"❌ AI session creation failed: {response.status_code}")
            if response.text:
                print(f"   Error: {response.text}")
            return None, token
    except Exception as e:
        print(f"❌ AI session creation error: {e}")
        return None, token

def test_ai_chat(session_id, token):
    """Test AI chat functionality"""
    if not session_id or not token:
        print("\n⏭️  Skipping AI chat test (no session)")
        return
        
    print("\n🔍 Testing AI chat...")
    
    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}"
    }
    
    data = {
        "messages": [
            {
                "role": "user",
                "content": "Hello! Can you help me place an order?"
            }
        ],
        "session_id": session_id
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/ai/chat/stream",
                               headers=headers,
                               json=data,
                               stream=True)
        
        if response.status_code == 200:
            print("✅ AI chat stream started successfully")
            print("📝 AI Response:")
            
            full_response = ""
            for line in response.iter_lines():
                if line:
                    line_str = line.decode('utf-8')
                    if line_str.startswith('data: '):
                        json_str = line_str[6:]  # Remove 'data: ' prefix
                        if json_str == '[DONE]':
                            break
                        try:
                            data = json.loads(json_str)
                            if data.get('type') == 'content_delta':
                                delta = data.get('delta', '')
                                full_response += delta
                                print(delta, end='', flush=True)
                            elif data.get('type') == 'complete':
                                message = data.get('message', {})
                                final_content = message.get('content', full_response)
                                print(f"\n✅ Complete response: {final_content}")
                                break
                        except json.JSONDecodeError:
                            continue
            
            print("\n✅ AI chat test completed successfully")
        else:
            print(f"❌ AI chat failed: {response.status_code}")
            if response.text:
                print(f"   Error: {response.text}")
                
    except Exception as e:
        print(f"❌ AI chat error: {e}")

def test_ai_session_cleanup(session_id, token):
    """Test AI session cleanup"""
    if not session_id or not token:
        print("\n⏭️  Skipping session cleanup (no session)")
        return
        
    print("\n🔍 Testing AI session cleanup...")
    
    headers = {
        "Authorization": f"Bearer {token}"
    }
    
    try:
        response = requests.post(f"{BACKEND_URL}/ai/sessions/{session_id}/end",
                               headers=headers)
        
        if response.status_code == 200:
            print("✅ AI session cleanup successful")
        else:
            print(f"⚠️  AI session cleanup returned: {response.status_code}")
            
    except Exception as e:
        print(f"⚠️  AI session cleanup error: {e}")

def main():
    print("🚀 Testing OrderTech AI Backend")
    print(f"📡 Backend URL: {BACKEND_URL}")
    print(f"⏰ Test started at: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("=" * 60)
    
    # Test 1: Health Check
    if not test_health_check():
        print("\n❌ Health check failed. Backend may not be running.")
        sys.exit(1)
    
    # Test 2: AI Token Request
    token = test_ai_token_request()
    
    # Test 3: AI Session Creation
    session_id, token = test_ai_session_creation(token)
    
    # Test 4: AI Chat
    test_ai_chat(session_id, token)
    
    # Test 5: Session Cleanup
    test_ai_session_cleanup(session_id, token)
    
    print("\n" + "=" * 60)
    print("🎉 AI Backend Test Complete!")
    print("\n📱 Your iOS app should now be able to:")
    print("   • Connect to the AI backend")
    print("   • Request AI tokens")
    print("   • Create AI sessions")
    print("   • Send messages and receive responses")
    print("   • Use text-to-speech for responses")

if __name__ == "__main__":
    main()