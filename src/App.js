import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { FaMicrophone, FaMapMarkerAlt, FaExclamationTriangle } from "react-icons/fa";
import "./App.css"; // Ensure you have basic CSS for centering

// CONNECT TO SERVER
const socket = io("https://emergency-server-uybe.onrender.com", {
  transports: ["websocket", "polling"]
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
    // 1. GET QR ID FROM URL (e.g., mysite.com?id=SmithFamily)
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    if (id) {
      socket.emit("join-room", id);
      setStatus("Connected to Family 🟢");
      sendLocation(id);
    } else {
      setStatus("Invalid QR Code 🔴");
    }

    // 2. LISTEN FOR MESSAGES & AUDIO FROM FAMILY
    socket.on("receive-chat", (data) => {
      setMessages((prev) => [...prev, data]);
    });

    socket.on("receive-audio", (base64Audio) => {
      const audio = new Audio(base64Audio);
      audio.play().catch(e => console.log("Audio play error", e));
    });

    return () => socket.disconnect();
  }, []);

  // --- LOCATION LOGIC ---
  const sendLocation = (id) => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          socket.emit("critical-alert", {
            qrId: id,
            message: "QR SCANNED! Location Shared.",
            location: { latitude, longitude } // Standard format for Mobile
          });
        },
        (error) => console.error("Location error", error),
        { enableHighAccuracy: true }
      );
    }
  };

  // --- AUDIO LOGIC (WEB) ---
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
          const base64Audio = reader.result; // DataURL
          socket.emit("send-audio", { qrId, audioBase64: base64Audio });
        };
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      alert("Microphone access denied. Please enable permissions.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  // --- SOS ALERT ---
  const triggerSOS = () => {
    if (!qrId) return;
    socket.emit("incoming-alarm", { qrId }); // Triggers loud alarm on phone
    alert("SOS Signal Sent to Family!");
  };

  const sendMessage = () => {
    if (!inputText.trim()) return;
    const msg = { qrId, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg);
    setMessages((prev) => [...prev, msg]);
    setInputText("");
  };

  if (!qrId) return <div className="error-screen"><h1>Invalid QR Code</h1></div>;

  return (
    <div className="container">
      <header className="header-alert">
        <FaExclamationTriangle className="alert-icon" />
        <h1>EMERGENCY ASSIST</h1>
        <p>You are connected to the owner.</p>
      </header>

      <div className="main-actions">
        <button className="sos-btn" onClick={triggerSOS}>
          SEND SOS ALERT 🚨
        </button>

        <button 
          className={`ptt-btn ${isRecording ? "recording" : ""}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
        >
          <FaMicrophone size={30} />
          {isRecording ? "Release to Send" : "Hold to Speak"}
        </button>
      </div>

      <div className="chat-box">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.sender === "Helper" ? "me" : "them"}`}>
              <strong>{m.sender}: </strong> {m.text}
            </div>
          ))}
        </div>
        <div className="input-area">
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            placeholder="Type a message..." 
          />
          <button onClick={sendMessage}>Send</button>
        </div>
      </div>
    </div>
  );
}

export default App;