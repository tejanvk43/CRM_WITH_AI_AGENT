import pytest
from fastapi.testclient import TestClient
from main import app, ACTIVE_CALLS

client = TestClient(app)


def test_health():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_scenario_1_product_question():
    call_id = 1001
    
    # 1. Start Call
    start_resp = client.post("/call/start", json={"call_id": call_id})
    assert start_resp.status_code == 200
    assert "consent_script" in start_resp.json()
    assert call_id in ACTIVE_CALLS
    
    # 2. Turn: Product Question
    turn_resp = client.post(
        "/call/turn",
        json={"call_id": call_id, "transcript_text": "What is the interest rate on Pay-in-3?"}
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["intent"] == "product_question"
    assert "0%" in data["suggestion"]
    assert len(data["retrieved_facts"]) > 0
    assert data["compliance_flag"] is False
    assert data["cost_usd"] > 0
    
    # 3. End Call
    end_resp = client.post("/call/end", json={"call_id": call_id})
    assert end_resp.status_code == 200
    end_data = end_resp.json()
    assert "product_question" in end_data["summary"]
    assert end_data["self_check_passed"] is True
    assert len(end_data["corrections"]) == 0
    assert end_data["total_cost_usd"] > 0
    assert call_id not in ACTIVE_CALLS


def test_scenario_2_kyc_question():
    call_id = 1002
    
    # Start Call
    client.post("/call/start", json={"call_id": call_id})
    
    # Turn: KYC Question
    turn_resp = client.post(
        "/call/turn",
        json={"call_id": call_id, "transcript_text": "What documents do I need to upload for onboard?"}
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["intent"] == "kyc_question"
    assert "onboarding" in data["suggestion"] or "link" in data["suggestion"]
    assert data["compliance_flag"] is False
    
    # End Call
    end_resp = client.post("/call/end", json={"call_id": call_id})
    assert end_resp.status_code == 200
    assert end_resp.json()["self_check_passed"] is True


def test_scenario_3_objection():
    call_id = 1003
    
    # Start Call
    client.post("/call/start", json={"call_id": call_id})
    
    # Turn: Objection
    turn_resp = client.post(
        "/call/turn",
        json={"call_id": call_id, "transcript_text": "Nothing is ever free. I think there are hidden charges."}
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    assert data["intent"] == "objection"
    assert "late fee" in data["suggestion"]
    assert data["compliance_flag"] is False
    
    # End Call
    end_resp = client.post("/call/end", json={"call_id": call_id})
    assert end_resp.status_code == 200
    assert end_resp.json()["self_check_passed"] is True


def test_scenario_4_sensitive_guarantee():
    call_id = 1004
    
    # Start Call
    client.post("/call/start", json={"call_id": call_id})
    
    # Turn: Sensitive guarantee question
    turn_resp = client.post(
        "/call/turn",
        json={"call_id": call_id, "transcript_text": "Can you guarantee my loan approval?"}
    )
    assert turn_resp.status_code == 200
    data = turn_resp.json()
    # Sensitive credit-terms trigger
    assert data["compliance_flag"] is True
    assert "[human_judgment_required]" in data["suggestion"]
    
    # End Call
    end_resp = client.post("/call/end", json={"call_id": call_id})
    assert end_resp.status_code == 200
    assert end_resp.json()["self_check_passed"] is True


def test_scenario_5_stale_fact():
    call_id = 1005
    
    # Start Call
    client.post("/call/start", json={"call_id": call_id})
    
    # Turn: Ask normal turn
    client.post(
        "/call/turn",
        json={"call_id": call_id, "transcript_text": "What is the late fee?"}
    )
    
    # Manually inject stale suggestion into the server's call history
    assert call_id in ACTIVE_CALLS
    ACTIVE_CALLS[call_id]["transcript"][-1]["suggestion"] = "The late fee is ₹99."
    
    # End Call
    end_resp = client.post("/call/end", json={"call_id": call_id})
    assert end_resp.status_code == 200
    data = end_resp.json()
    
    # Verification of facts check failure and corrections list
    assert data["self_check_passed"] is False
    assert len(data["corrections"]) > 0
    assert any("₹99" in err and "₹199" in err for err in data["corrections"])
