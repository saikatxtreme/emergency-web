import React, { useEffect, useState, useRef } from "react";
import io from "socket.io-client";
import { FaMicrophone, FaPaperPlane, FaStop, FaExclamationTriangle, FaMapMarkerAlt, FaShieldAlt } from "react-icons/fa";
import "./App.css"; 

// --- CONFIG ---
const SERVER_URL = "https://emergency-server-uybe.onrender.com";

const socket = io(SERVER_URL, {
  transports: ["websocket", "polling"],
  reconnectionAttempts: 10,
});

function App() {
  const [status, setStatus] = useState("Connecting...");
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState("");
  const [qrId, setQrId] = useState(null);
  const [isRecording, setIsRecording] = useState(false); // TOGGLE STATE
  
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const messagesEndRef = useRef(null);

  // --- SCROLL TO BOTTOM ---
  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // --- INITIAL SETUP ---
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    setQrId(id);

    const handleJoin = () => {
        if (id) {
            socket.emit("join-room", id);
            setStatus("Connected 🟢");
            setIsConnected(true);
            updateLocation(id, true);
        } else {
            setStatus("Invalid QR Code 🔴");
        }
    };

    socket.on("connect", handleJoin);
    if(socket.connected) handleJoin();

    socket.on("disconnect", () => { setStatus("Disconnected 🔴"); setIsConnected(false); });
    socket.on("receive-chat", (data) => setMessages((prev) => [...prev, data]));
    socket.on("receive-audio", (base64Audio) => {
        const audioMsg = { sender: "Family", type: "audio", text: "Sent an audio clip", audioData: base64Audio };
        setMessages((prev) => [...prev, audioMsg]);
    });

    return () => { socket.off("connect"); socket.off("disconnect"); socket.off("receive-chat"); socket.off("receive-audio"); };
  }, []);

  // --- SEND LOCATION ---
  const updateLocation = (idToUse = qrId, silent = false) => {
    if (!idToUse) return;
    if ("geolocation" in navigator) {
        if(!silent) alert("Updating Location... Please allow GPS.");
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                socket.emit("critical-alert", { qrId: idToUse, message: "Location Updated", location: { latitude, longitude } });
                if(!silent) alert("Location Sent! ✅");
            },
            (err) => { console.error(err); if(!silent) alert("Could not get location."); },
            { enableHighAccuracy: true }
        );
    }
  };

  // --- NEW: TOGGLE RECORDING LOGIC ---
  const toggleRecording = async () => {
    // A. IF RECORDING -> STOP & SEND
    if (isRecording) {
        if (mediaRecorderRef.current) {
            mediaRecorderRef.current.stop(); // This triggers 'onstop' event below
            setIsRecording(false);
        }
        return;
    }

    // B. IF IDLE -> START RECORDING
    try {
        if (navigator.vibrate) navigator.vibrate(50);
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        audioChunksRef.current = [];

        mediaRecorderRef.current.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunksRef.current.push(e.data);
        };

        // When we stop later, this runs:
        mediaRecorderRef.current.onstop = () => {
            const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64 = reader.result;
                socket.emit("send-audio", { qrId, audioBase64: base64 });
                
                // Add to my chat
                setMessages(prev => [...prev, { sender: "Helper", type: "audio", audioData: base64 }]);
            };
            
            // Turn off mic stream to save battery/privacy
            stream.getTracks().forEach(track => track.stop());
        };

        mediaRecorderRef.current.start();
        setIsRecording(true);

    } catch (err) {
        alert("Microphone access denied. Check your browser permissions.");
        setIsRecording(false);
    }
  };

  // --- TEXT CHAT ---
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
    if(window.confirm("🚨 TRIGGER LOUD ALARM?")) {
        socket.emit("incoming-alarm", { qrId }); 
        alert("ALARM SENT! 🚨");
    }
  };

  if (!qrId) return <div className="app-container" style={{justifyContent:'center', alignItems:'center'}}><h3>🚫 Invalid QR Code</h3></div>;

  return (
    <div className="app-container">
      <div className="header">
        <div className="brand"><FaShieldAlt color="#ff4444" size={22} /><span>EMERGO ASSIST</span></div>
        <span className={`status-badge ${isConnected ? 'connected' : ''}`}>{status}</span>
      </div>

      <div className="controls-grid">
        <button className="btn btn-sos" onClick={triggerSOS}><FaExclamationTriangle /> SEND SOS ALERT</button>
        <button className="btn btn-loc" onClick={() => updateLocation()}><FaMapMarkerAlt /> UPDATE LOC</button>

        {/* --- NEW TOGGLE BUTTON --- */}
        <button 
            className={`btn btn-mic ${isRecording ? 'recording' : ''}`}
            onClick={toggleRecording} // Simple Click Handler
        >
            {isRecording ? <FaStop /> : <FaMicrophone />} 
            {isRecording ? "TAP TO SEND" : "TAP TO RECORD"}
        </button>
      </div>

      <div className="chat-area">
        {messages.length === 0 && <div style={{textAlign:'center', color:'#555', marginTop:30}}>Start messaging the owner...</div>}
        {messages.map((m, i) => (
            <div key={i} className={`msg ${m.sender === "Helper" ? "me" : "them"}`}>
                <span className="msg-sender">{m.sender}</span>
                {m.type !== 'audio' && m.text}
                {m.type === 'audio' && (<audio controls src={m.audioData} className="audio-player" />)}
            </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      <form className="input-area" onSubmit={sendMessage}>
        <input className="chat-input" value={inputText} onChange={(e) => setInputText(e.target.value)} placeholder="Type message..." />
        <button type="submit" className="btn-send"><FaPaperPlane /></button>
      </form>
    </div>
  );
}

export default App;