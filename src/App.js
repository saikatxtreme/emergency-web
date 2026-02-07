import React, { useEffect, useState, useRef } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import { FaMicrophone, FaPaperPlane, FaBell, FaCircle, FaStop, FaMapMarkerAlt } from 'react-icons/fa';
import { motion, AnimatePresence } from 'framer-motion';

// --- LEAFLET ICON FIX ---
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

const SERVER_URL = "https://emergency-server-uybe.onrender.com"; 
const urlParams = new URLSearchParams(window.location.search);
const QR_ID = urlParams.get('id') || "default-car"; 

// Initialize Socket
const socket = io(SERVER_URL, {
  transports: ['websocket'], 
  reconnection: true, 
  reconnectionAttempts: Infinity,
  autoConnect: true,
});

// Component to fly map to new location
function MapUpdater({ location }) {
  const map = useMap();
  useEffect(() => {
    if (location) map.flyTo(location, 16, { animate: true, duration: 1.5 });
  }, [location, map]);
  return null;
}

export default function App() {
  const [status, setStatus] = useState("Connecting...");
  const [chat, setChat] = useState([]);
  const [inputText, setInputText] = useState("");
  const [location, setLocation] = useState(null); // Default to null, will wait for GPS
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const chatEndRef = useRef(null);

  // Auto-scroll chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat]);

  useEffect(() => {
    // --- CONNECTION LOGIC ---
    const handleConnect = () => {
        console.log("Connected. Joining:", QR_ID);
        setStatus("LIVE LINK ACTIVE");
        socket.emit("join-family", QR_ID);
        if (location) {
             socket.emit("scan-qr", { qrId: QR_ID, location: {lat: location[0], lng: location[1]} });
        }
    };

    socket.on("connect", handleConnect);
    
    // Heartbeat
    const heartbeat = setInterval(() => {
        if (socket.connected) socket.emit("join-family", QR_ID);
        else socket.connect();
    }, 5000);

    socket.on("receive-chat", (data) => setChat(prev => [...prev, data]));
    
    socket.on("receive-audio", (audioBase64) => {
        try {
            const audio = new Audio(audioBase64);
            audio.play().catch(e => console.log("Autoplay blocked"));
        } catch (e) { console.error(e); }
    });

    socket.on("disconnect", () => setStatus("SIGNAL LOST - RECONNECTING..."));

    // --- GPS LOGIC ---
    let watchId;
    if (navigator.geolocation) {
        watchId = navigator.geolocation.watchPosition((pos) => {
            const newLoc = [pos.coords.latitude, pos.coords.longitude];
            setLocation(newLoc);
            if(socket.connected) {
                socket.emit("scan-qr", { qrId: QR_ID, location: {lat: newLoc[0], lng: newLoc[1]} });
            }
        }, (err) => console.log("GPS Error", err), { enableHighAccuracy: true });
    }

    return () => {
        clearInterval(heartbeat);
        socket.off("connect");
        socket.off("receive-chat");
        socket.off("receive-audio");
        socket.off("disconnect");
        if (watchId) navigator.geolocation.clearWatch(watchId);
    };
  }, []);

  // --- ACTIONS ---
  const triggerAlert = () => {
      if(window.confirm("🚨 SEND EMERGENCY ALERT?\n\nThis will trigger a loud alarm on the owner's device.")) {
          socket.emit("trigger-alert", QR_ID);
          alert("ALERT SENT");
      }
  };

  const startRecording = async () => {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorderRef.current = new MediaRecorder(stream);
        const chunks = [];
        mediaRecorderRef.current.ondataavailable = (e) => chunks.push(e.data);
        mediaRecorderRef.current.onstop = () => {
             const blob = new Blob(chunks, { type: 'audio/webm' });
             const reader = new FileReader();
             reader.readAsDataURL(blob);
             reader.onloadend = () => {
                 socket.emit("send-audio", { qrId: QR_ID, audioBase64: reader.result });
             };
        };
        mediaRecorderRef.current.start();
        setIsRecording(true);
    } catch (err) { alert("Mic Access Denied"); }
  };

  const stopRecording = () => {
      if (mediaRecorderRef.current) mediaRecorderRef.current.stop();
      setIsRecording(false);
  };

  const sendText = (e) => {
    e.preventDefault();
    if (!inputText) return;
    const msg = { qrId: QR_ID, text: inputText, sender: "Helper" };
    socket.emit("send-chat", msg);
    setChat(prev => [...prev, msg]); 
    setInputText("");
  };

  return (
    <div style={styles.dashboard}>
      
      {/* --- LAYER 1: THE MAP (BACKGROUND) --- */}
      <div style={styles.mapContainer}>
        {location ? (
          <MapContainer center={location} zoom={13} style={{ width: '100%', height: '100%' }} zoomControl={false}>
            {/* Dark Mode Map Tiles */}
            <TileLayer url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png" />
            <Marker position={location}>
                <Popup>
                    <div style={{color: 'black'}}>Last Known Position</div>
                </Popup>
            </Marker>
            <MapUpdater location={location} />
          </MapContainer>
        ) : (
          <div style={styles.loadingScreen}>
            <FaMapMarkerAlt size={50} color="#e74c3c" />
            <p>ACQUIRING SATELLITE FIX...</p>
          </div>
        )}
      </div>

      {/* --- LAYER 2: TOP BAR (STATUS) --- */}
      <div style={styles.topBar}>
        <div style={styles.statusBadge}>
            <motion.div 
                animate={{ opacity: [1, 0.5, 1] }} 
                transition={{ duration: 2, repeat: Infinity }}
            >
                <FaCircle color={status.includes("ACTIVE") ? "#2ecc71" : "#e74c3c"} size={12} />
            </motion.div>
            <span style={styles.statusText}>{status}</span>
        </div>
        <button onClick={triggerAlert} style={styles.alertButton}>
            <FaBell /> SOS ALERT
        </button>
      </div>

      {/* --- LAYER 3: BOTTOM CONSOLE (CHAT & MIC) --- */}
      <div style={styles.console}>
        
        {/* Chat Area */}
        <div style={styles.chatWindow}>
            <div style={styles.chatFeed}>
                <AnimatePresence>
                    {chat.map((msg, i) => (
                        <motion.div 
                            key={i} 
                            initial={{ opacity: 0, y: 10 }} 
                            animate={{ opacity: 1, y: 0 }}
                            style={msg.sender === "Helper" ? styles.msgSelf : styles.msgOther}
                        >
                            <span style={styles.msgLabel}>{msg.sender}</span>
                            {msg.text}
                        </motion.div>
                    ))}
                    <div ref={chatEndRef} />
                </AnimatePresence>
            </div>
            
            <form onSubmit={sendText} style={styles.inputRow}>
                <input 
                    value={inputText} 
                    onChange={(e) => setInputText(e.target.value)} 
                    placeholder="Type to dispatch..." 
                    style={styles.input} 
                />
                <button type="submit" style={styles.sendBtn}><FaPaperPlane /></button>
            </form>
        </div>

        {/* PTT Button */}
        <div style={styles.micControl}>
            <motion.button 
                whileTap={{ scale: 0.9 }}
                animate={isRecording ? { boxShadow: "0px 0px 20px #e74c3c" } : {}}
                onClick={isRecording ? stopRecording : startRecording}
                style={{
                    ...styles.micBtn, 
                    background: isRecording ? "#e74c3c" : "#34495e"
                }}
            >
                {isRecording ? <FaStop size={24} /> : <FaMicrophone size={24} />}
            </motion.button>
            <span style={styles.micLabel}>{isRecording ? "TRANSMITTING..." : "PUSH TO TALK"}</span>
        </div>

      </div>
    </div>
  );
}

// --- FUTURISTIC STYLES ---
const styles = {
  dashboard: {
    height: "100vh",
    width: "100vw",
    overflow: "hidden",
    position: "relative",
    backgroundColor: "#1a1a1a",
    fontFamily: "'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  },
  mapContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    zIndex: 1,
  },
  loadingScreen: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    color: "#7f8c8d",
    gap: "20px",
    letterSpacing: "2px",
  },
  topBar: {
    position: "absolute",
    top: 20,
    left: 20,
    right: 20,
    zIndex: 10,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    pointerEvents: "none", // Let clicks pass through to map where unoccupied
  },
  statusBadge: {
    background: "rgba(0, 0, 0, 0.6)",
    backdropFilter: "blur(10px)",
    padding: "10px 20px",
    borderRadius: "30px",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    border: "1px solid rgba(255,255,255,0.1)",
    pointerEvents: "auto",
  },
  statusText: {
    color: "white",
    fontSize: "12px",
    fontWeight: "bold",
    letterSpacing: "1px",
  },
  alertButton: {
    background: "#c0392b",
    color: "white",
    border: "none",
    padding: "10px 20px",
    borderRadius: "30px",
    fontWeight: "bold",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    cursor: "pointer",
    boxShadow: "0 4px 15px rgba(192, 57, 43, 0.4)",
    pointerEvents: "auto",
  },
  console: {
    position: "absolute",
    bottom: 20,
    left: 20,
    right: 20,
    zIndex: 10,
    display: "flex",
    gap: "15px",
    height: "220px",
    alignItems: "flex-end",
  },
  chatWindow: {
    flex: 1,
    background: "rgba(0, 0, 0, 0.8)",
    backdropFilter: "blur(15px)",
    borderRadius: "16px",
    border: "1px solid rgba(255,255,255,0.1)",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
  },
  chatFeed: {
    flex: 1,
    padding: "15px",
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: "10px",
  },
  msgSelf: {
    alignSelf: "flex-end",
    background: "#2980b9",
    color: "white",
    padding: "8px 14px",
    borderRadius: "15px 15px 0 15px",
    fontSize: "14px",
    maxWidth: "80%",
  },
  msgOther: {
    alignSelf: "flex-start",
    background: "#34495e",
    color: "#ecf0f1",
    padding: "8px 14px",
    borderRadius: "15px 15px 15px 0",
    fontSize: "14px",
    maxWidth: "80%",
  },
  msgLabel: {
    display: "block",
    fontSize: "9px",
    opacity: 0.7,
    marginBottom: "2px",
    textTransform: "uppercase",
  },
  inputRow: {
    display: "flex",
    padding: "10px",
    gap: "10px",
    borderTop: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(0,0,0,0.2)",
  },
  input: {
    flex: 1,
    background: "rgba(255,255,255,0.1)",
    border: "none",
    padding: "10px 15px",
    borderRadius: "8px",
    color: "white",
    outline: "none",
  },
  sendBtn: {
    background: "#2980b9",
    border: "none",
    width: "40px",
    borderRadius: "8px",
    color: "white",
    cursor: "pointer",
  },
  micControl: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
  },
  micBtn: {
    width: "70px",
    height: "70px",
    borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.2)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.3s ease",
  },
  micLabel: {
    color: "white",
    fontSize: "10px",
    fontWeight: "bold",
    letterSpacing: "1px",
    textShadow: "0 2px 4px rgba(0,0,0,0.5)",
  }
};