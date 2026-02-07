import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { FaMicrophone, FaPaperPlane, FaExclamationTriangle } from "react-icons/fa";
import "./App.css"; 

const socket = io("https://emergency-server-uybe.onrender.com", {
  transports: ["websocket", "polling"]
});

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [qrId, setQrId] = useState(null);
  
  // AUDIO STATES
  const [audioState, setAudioState] = useState("idle"); // idle | recording | sent
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    const handleJoin = () => {
        if (id) {
            socket.emit("join-room", id);
            setStatus("Connected 🟢");
            // Auto-send location
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => socket.emit("critical-alert", { qrId: id, message: "Location Shared", location: pos.coords }),
                    (err) => console.log(err),
                    { enableHighAccuracy: true }
                );
            }
        } else {
            setStatus("Invalid QR 🔴");
        }
    };

    socket.on("connect", handleJoin);
    if(socket.connected) handleJoin();

    socket.on("receive-chat", (data) => setMessages((prev) => [...prev, data]));

    return () => { socket.off("connect"); socket.off("receive-chat"); };
  }, []);

  // --- NEW AUDIO LOGIC ---
  const startRecording = async (e) => {
    e.preventDefault(); // Stop text selection
    if (audioState === "recording") return;

    try {
      // Vibration feedback for mobile
      if (navigator.vibrate) navigator.vibrate(50); 
      
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
          // Send to mobile
          socket.emit("send-audio", { qrId, audioBase64: base64Audio });
          
          // Visual Feedback: Show "Sent" for 1.5 seconds
          setAudioState("sent");
          setTimeout(() => setAudioState("idle"), 1500);
        };
      };

      mediaRecorderRef.current.start();
      setAudioState("recording");
    } catch (err) {
      alert("Microphone permission denied. Please allow access.");
      setAudioState("idle");
    }
  };

  const stopRecording = (e) => {
    e.preventDefault();
    if (mediaRecorderRef.current && audioState === "recording") {
      mediaRecorderRef.current.stop();
      // Don't set idle here, wait for 'onstop' to set 'sent'
    }
  };

  const sendMessage = (e) => {
    e.preventDefault();
    if (!inputText.trim()) return;
    const msg = { qrId, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg);
    setMessages((prev) => [...prev, msg]);
    setInputText("");
  };

  const triggerSOS = () => {
    if (!qrId) return;
    if(window.confirm("🚨 SEND SOS ALERT?")) {
        socket.emit("incoming-alarm", { qrId }); 
        alert("SOS SENT!");
    }
  };

  if (!qrId) return <div className="app-container" style={{justifyContent:'center'}}><h2>Invalid QR</h2></div>;

  return (
    <div className="app-container">
      <div className="header">
        <h2><FaExclamationTriangle color="#ff4444" /> EMERGENCY ASSIST</h2>
        <span className="status-badge">{status}</span>
      </div>

      <div className="control-panel">
        <button className="sos-btn" onClick={triggerSOS}>SEND SOS ALERT 🚨</button>

        {/* INTUITIVE AUDIO BUTTON */}
        <button 
          className={`ptt-btn ${audioState}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
          onMouseLeave={stopRecording} // Handles dragging finger off button
        >
          <FaMicrophone size={24} />
          {audioState === "idle" && "HOLD TO SPEAK"}
          {audioState === "recording" && "RECORDING... (Release to Send)"}
          {audioState === "sent" && "AUDIO SENT! ✔️"}
        </button>
      </div>

      <div className="chat-window">
        <div className="messages">
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.sender === "Helper" ? "me" : "them"}`}>
              {m.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        <form className="input-area" onSubmit={sendMessage}>
          <input value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type message..." />
          <button type="submit"><FaPaperPlane /></button>
        </form>
      </div>
    </div>
  );
}

export default App;