import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
// Use React Icons for polish (Install if missing: npm install react-icons)
import { FaMicrophone, FaPaperPlane, FaExclamationTriangle, FaMapMarkerAlt } from "react-icons/fa";
import "./App.css"; 

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
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom of chat
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    const handleJoin = () => {
        if (id) {
            socket.emit("join-room", id);
            setStatus("Connected to Family 🟢");
            // Auto-send location on join
            if ("geolocation" in navigator) {
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        socket.emit("critical-alert", {
                            qrId: id,
                            message: "Location Shared",
                            location: { latitude: pos.coords.latitude, longitude: pos.coords.longitude }
                        });
                    },
                    (err) => console.log(err),
                    { enableHighAccuracy: true }
                );
            }
        } else {
            setStatus("Invalid QR Code 🔴");
        }
    };

    socket.on("connect", handleJoin);
    if(socket.connected) handleJoin();

    socket.on("receive-chat", (data) => setMessages((prev) => [...prev, data]));

    socket.on("receive-audio", (base64Audio) => {
      try {
        const audio = new Audio(base64Audio);
        audio.play();
      } catch(e) {}
    });

    return () => {
        socket.off("connect");
        socket.off("receive-chat");
        socket.off("receive-audio");
    };
  }, []);

  // --- ACTIONS ---
  const triggerSOS = () => {
    if (!qrId) return;
    if(window.confirm("🚨 SEND EMERGENCY ALERT?\n\nThis will trigger a loud alarm on the owner's device.")) {
        socket.emit("incoming-alarm", { qrId }); 
        alert("SOS SENT! Owner alerted.");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
            socket.emit("send-audio", { qrId, audioBase64: reader.result });
        };
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) { alert("Microphone access needed."); }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        setIsRecording(false);
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

  if (!qrId) return <div className="app-container" style={{justifyContent:'center', alignItems:'center'}}><h2>🚫 Invalid QR Code</h2></div>;

  return (
    <div className="app-container">
      {/* HEADER */}
      <div className="header">
        <h2><FaExclamationTriangle color="#ff4444" /> EMERGENCY ASSIST</h2>
        <span className="status-badge">{status}</span>
      </div>

      {/* CONTROLS */}
      <div className="control-panel">
        <button className="sos-btn" onClick={triggerSOS}>
          SEND SOS ALERT 🚨
        </button>

        <button 
          className={`ptt-btn ${isRecording ? 'recording' : ''}`}
          onMouseDown={startRecording}
          onMouseUp={stopRecording}
          onTouchStart={startRecording}
          onTouchEnd={stopRecording}
        >
          <FaMicrophone size={20} />
          {isRecording ? "Release to Send" : "Hold to Speak"}
        </button>
      </div>

      {/* CHAT */}
      <div className="chat-window">
        <div className="messages">
          {messages.length === 0 && <div style={{textAlign:'center', color:'#555', marginTop: 20}}>No messages yet...</div>}
          {messages.map((m, i) => (
            <div key={i} className={`msg ${m.sender === "Helper" ? "me" : "them"}`}>
              {m.text}
            </div>
          ))}
          <div ref={messagesEndRef} />
        </div>
        
        <form className="input-area" onSubmit={sendMessage}>
          <input 
            value={inputText} 
            onChange={(e) => setInputText(e.target.value)} 
            placeholder="Type message..." 
          />
          <button type="submit"><FaPaperPlane /></button>
        </form>
      </div>
    </div>
  );
}

export default App;