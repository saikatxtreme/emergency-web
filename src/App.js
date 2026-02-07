import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { FaMicrophone, FaExclamationTriangle, FaPaperPlane } from "react-icons/fa";
import "./App.css"; 

// --- CONFIG ---
const SERVER_URL = "https://emergency-server-uybe.onrender.com";

// Connection Options (Polling first for reliability)
const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnectionAttempts: 5
});

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [qrId, setQrId] = useState(null);
  const [isRecording, setIsRecording] = useState(false);
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  useEffect(() => {
    // 1. GET QR ID FROM URL
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    // 2. JOIN ROOM LOGIC (CRITICAL FIX)
    const handleJoin = () => {
        if (id) {
            console.log("Joining Room:", id);
            socket.emit("join-room", id);
            setStatus("Connected to Family 🟢");
            // Send location immediately when connected
            sendLocation(id);
        } else {
            setStatus("Invalid QR Code 🔴");
        }
    };

    // Join on connect and reconnect
    socket.on("connect", handleJoin);
    if (socket.connected) handleJoin();

    // 3. LISTEN FOR EVENTS
    socket.on("receive-chat", (data) => {
      console.log("Chat Received:", data);
      setMessages((prev) => [...prev, data]);
    });

    socket.on("receive-audio", (base64Audio) => {
      try {
        const audio = new Audio(base64Audio);
        audio.play().catch(e => console.error("Audio Play Error:", e));
      } catch (e) { console.error("Audio Decode Error:", e); }
    });

    return () => {
      socket.off("connect", handleJoin);
      socket.off("receive-chat");
      socket.off("receive-audio");
    };
  }, []);

  // --- LOCATION LOGIC ---
  const sendLocation = (id) => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          // Sends to 'critical-alert' so mobile app sees it as a Location Update
          socket.emit("critical-alert", {
            qrId: id,
            message: "QR SCANNED! Location Shared.",
            location: { latitude, longitude }
          });
        },
        (err) => console.error("Location permission denied", err),
        { enableHighAccuracy: true }
      );
    }
  };

  // --- SOS LOGIC ---
  const triggerSOS = () => {
    if (!qrId) return;
    socket.emit("incoming-alarm", { qrId }); // Triggers phone vibration/sound
    alert("🚨 SOS SIGNAL SENT! The owner has been alerted.");
  };

  // --- AUDIO LOGIC ---
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];

      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64Audio = reader.result; 
          socket.emit("send-audio", { qrId, audioBase64: base64Audio });
        };
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Please allow microphone access to use the Walkie-Talkie.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // --- CHAT LOGIC ---
  const sendMessage = () => {
    if (!inputText.trim()) return;
    const msg = { qrId, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg); // Matches Mobile App listener
    setMessages((prev) => [...prev, msg]);
    setInputText("");
  };

  if (!qrId) return <div style={{padding:50, textAlign:"center", fontFamily:"sans-serif"}}><h1>❌ Invalid QR Link</h1></div>;

  return (
    <div className="app-container">
      <div className="header-alert">
        <FaExclamationTriangle className="alert-icon" />
        <div>
            <h2>EMERGENCY ASSIST</h2>
            <small>{status}</small>
        </div>
      </div>

      <div className="controls">
        <button className="sos-btn" onClick={triggerSOS}>
          🚨 SEND SOS ALERT
        </button>

        <button 
          className={`ptt-btn ${isRecording ? 'recording' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
        >
          <FaMicrophone size={24} />
          {isRecording ? "Release to Send" : "Hold to Speak"}
        </button>
      </div>

      <div className="chat-interface">
        <div className="messages-list">
          {messages.length === 0 && <div style={{color:'#ccc', textAlign:'center', marginTop:20}}>No messages yet...</div>}
          {messages.map((m, i) => (
            <div key={i} className={`msg-bubble ${m.sender === "Helper" ? "me" : "them"}`}>
              <strong>{m.sender}: </strong> {m.text}
            </div>
          ))}
        </div>
        
        <div className="input-bar">
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            placeholder="Type message..." 
            onKeyPress={(e) => e.key === 'Enter' && sendMessage()}
          />
          <button onClick={sendMessage}><FaPaperPlane /></button>
        </div>
      </div>
    </div>
  );
}

export default App;