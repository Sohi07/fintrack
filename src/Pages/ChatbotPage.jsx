'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from "../components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { Lightbulb, Send, SmilePlus, Phone, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { GoogleGenerativeAI } from "@google/generative-ai";
import axios from 'axios';
import ProfileButton from '../components/components/profile';
import Sidebar from '../components/components/Sidebar';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDoc, collection, addDoc, query, where, orderBy, getDocs, onSnapshot } from 'firebase/firestore';
import { useTranslation } from 'react-i18next';

import { ToastContainer, toast } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

// Init Firebase services
const auth = getAuth();
const db = getFirestore();

// Init Gemini
const genAI = new GoogleGenerativeAI(import.meta.env.VITE_GEN_AI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

// Dynamically load emoji picker
const EmojiPicker = dynamic(() => import('emoji-picker-react'), {
  loading: () => <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
  </div>,
  ssr: false
});

// Translation helper
const translateText = async (text, targetLang) => {
  if (targetLang === 'en') return text;
  try {
    const response = await fetch(
      `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`
    );
    const data = await response.json();
    return data[0].map((item) => item[0]).join('');
  } catch (error) {
    console.error("Translation failed:", error);
    return text; // fallback
  }
};

// Contextual Prompt
const generateContextualPrompt = (userData, messages, userInput, lang = 'en') => {
  return `You are an intelligent financial assistant. Please reply in this language: ${lang}

Financial Overview:
- Total Balance: ₹${userData?.totalBalance || 0}
- Monthly Income: ₹${userData?.accounts?.reduce((sum, acc) => sum + (acc.isRecurringIncome ? acc.recurringAmount : 0), 0) || 0}
- Savings Goal: ₹${userData?.savingsGoal || 0}

Recent Activity:
${userData?.expenses?.slice(-3).map(exp => 
  `- ${exp.category}: ₹${exp.amount} (${new Date(exp.date).toLocaleDateString()})`
).join('\n')}

Recent Chat:
${messages.slice(-3).map(m => `${m.sender}: ${m.text}`).join('\n')}

User's new message: ${userInput}

Please provide a helpful and personalized response in ${lang}.`;
};

export default function ChatbotPage() {
  const { t, i18n } = useTranslation();
  const [messages, setMessages] = useState([
    {  text: t("chatbot.welcomeMessage"), sender: 'bot', timestamp: new Date() }
  ]);
  const [input, setInput] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  const messagesEndRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => scrollToBottom(), [messages]);

  useEffect(() => {
    const handleOffline = () => {
      toast.error(t("dashboard.offline"), {
        toastId: "offline-toast",
        autoClose: false,
        closeOnClick: false,
        draggable: false,
      });
    };

    const handleOnline = () => toast.dismiss("offline-toast");

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
    };
  }, [t]);

  // Handle emoji
  const onEmojiClick = (emojiData) => {
    setInput(prev => prev + emojiData.emoji);
    setShowEmojiPicker(false);
  };

  const formatTime = (timestamp) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString(i18n.language === "en" ? 'en-US' : undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  // Fetch user data and chat history
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      setUser(user)
      if (user) {
        // Fetch user data
        const userDoc = await getDoc(doc(db, 'users', user.uid))
        if (userDoc.exists()) {
          setUserData(userDoc.data())
        }

        // Fetch chat history
        const chatQuery = query(
          collection(db, 'chats'),
          where('userId', '==', user.uid),
          orderBy('timestamp', 'asc')
        )
        const chatSnapshot = await getDocs(chatQuery)
        const chatHistory = chatSnapshot.docs.map(doc => doc.data())
        
        if (chatHistory.length > 0) {
          setMessages(prev => [...prev, ...chatHistory])
        }
      }
    })
    return () => unsubscribe()
  }, [])

  // Scroll to bottom effect
  useEffect(() => {
    scrollToBottom()
  }, [messages])  // Save to Firestore
  const saveMessage = async (message) => {
    try {
      await addDoc(collection(db, 'chats'), {
        ...message,
        userId: user?.uid || 'guest',
        timestamp: new Date().toISOString()
      });
    } catch (err) {
      console.error("Firestore error:", err);
    }
  };

  // AI Response
  const generateResponse = async (userInput) => {
    try {
      const prompt = generateContextualPrompt(userData, messages, userInput, i18n.language);
      const result = await model.generateContent(prompt);
      const rawText = await result.response.text();
      const translatedText = await translateText(rawText, i18n.language);
      return translatedText;
    } catch (error) {
      console.error("Error generating response:", error);
      return t("chatbot.errorMessage");
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    
    const userMessage = {
      text: input,
      sender: 'user',
      timestamp: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);
    await saveMessage(userMessage);

    try {
      const aiText = await generateResponse(input);
      const botMessage = {
        text: aiText,
        sender: 'bot',
        timestamp: new Date().toISOString()
      };
      setMessages(prev => [...prev, botMessage]);
      await saveMessage(botMessage);
    } catch (error) {
      console.error('Send error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full">
      {/* Sidebar overlay */}
      {isSidebarOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-20" onClick={() => setIsSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} user={user} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col w-full">
        {/* Header */}
        <header className="bg-white shadow-sm sticky top-0 z-10 w-full">
          <div className="w-full px-4 py-3">
            <div className="flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Avatar className="h-8 w-8 sm:h-10 sm:w-10 bg-blue-500">
                  <AvatarImage src="/assets/robot.png" alt="AI" />
                  <AvatarFallback>AI</AvatarFallback>
                </Avatar>
                <div>
                  <h1 className="text-base sm:text-xl font-semibold text-gray-800">
                    {t('chatbot.header')}
                  </h1>
                  <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 hover:bg-green-100">
                    {isLoading ? t('chatbot.status.thinking') : t('chatbot.status.online')}
                  </Badge>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <ProfileButton
                  user={user}
                  onMenuToggle={() => setIsSidebarOpen(!isSidebarOpen)}
                  onLogout={() => auth.signOut()}
                  hideNameOnMobile={true}
                />
              </div>
            </div>
          </div>
        </header>

        {/* Chat */}
        <main className="flex-grow overflow-y-auto px-4 py-4 bg-white">
          <div className="space-y-4">
            {messages.map((message, index) => (
              <div key={index} className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} items-start gap-2`}>
                {message.sender === 'bot' && (
                  <Avatar className="h-8 w-8 bg-blue-500 flex-shrink-0 mt-1">
                    <AvatarImage src="/assets/robot.png" />
                    <AvatarFallback>AI</AvatarFallback>
                  </Avatar>
                )}

                <div className={`flex flex-col gap-1 ${message.sender === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`rounded-2xl px-3 py-2 max-w-[280px] sm:max-w-md md:max-w-lg ${
                    message.sender === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-100 text-gray-800'
                  }`}>
                    <div className="text-sm sm:text-base whitespace-pre-wrap">{message.text}</div>
                  </div>
                  <span className="text-xs text-gray-500 px-1">{formatTime(message.timestamp)}</span>
                </div>

                {message.sender === 'user' && (
                  <Avatar className="h-8 w-8 bg-blue-600 flex-shrink-0 mt-1">
                    <AvatarFallback className="text-white">{user?.displayName?.[0] || 'U'}</AvatarFallback>
                  </Avatar>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input */}
        <footer className="bg-white border-t p-3 sticky bottom-0 z-10 w-full">
          <div className="flex items-center gap-2">
            <div className="relative">
              <Button
                variant="ghost"
                size="icon"
                className="p-2 text-gray-400 hover:text-gray-600 rounded-full"
                onClick={() => setShowEmojiPicker(!showEmojiPicker)}
              >
                {showEmojiPicker ? <X className="h-5 w-5" /> : <SmilePlus className="h-5 w-5" />}
              </Button>
              {showEmojiPicker && (
                <div className="absolute bottom-12 left-0 z-10 shadow-lg rounded-lg transform scale-90 sm:scale-100 origin-bottom-left">
                  <EmojiPicker onEmojiClick={onEmojiClick} />
                </div>
              )}
            </div>

            <div className="flex-1 relative">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={t('chatbot.inputPlaceholder')}
                className="rounded-full border-gray-200 pr-12 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 text-sm sm:text-base py-2"
                onKeyPress={(e) => e.key === 'Enter' && handleSend()}
                disabled={isLoading}
              />
              <Button
                onClick={handleSend}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full h-8 w-8 p-0 flex items-center justify-center bg-blue-500 hover:bg-blue-600 transition-colors"
                disabled={isLoading}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </footer>
      </div>
      <ToastContainer position="top-center" />
    </div>
  );
}
