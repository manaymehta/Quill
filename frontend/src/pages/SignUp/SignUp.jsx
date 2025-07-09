import React, { useState } from 'react'
import { useEffect } from "react";
import Navbar from '../../components/Navbar/Navbar';
import { Link, useNavigate } from 'react-router-dom';
import PasswordInput from '../../components/Input/PasswordInput';
import { validateEmail } from '../../utils/helper';
import axiosInstance from '../../utils/axiosInstance';

const SignUp = () => {

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const navigate = useNavigate();

  const handleSignUp = async (e) => {
    e.preventDefault();
    if (!name) {
      setError("Please enter your name");
      return;
    }
    if (!validateEmail(email)) {
      setError("Please enter a valid email address");
      return;
    }
    if (!password) {
      setError("Please enter password");
      return;
    }
    setError("");

    //SignUp API 
    try {
      const response = await axiosInstance.post("/create-account", {
        fullName: name,
        email: email,
        password: password,
      });

      if (response.data && response.data.error) {
        setError(response.data.message)
        return
      }
      //Handle successful login response
      if (response.data && response.data.accessToken) {
        localStorage.setItem("token", response.data.accessToken);
        navigate("/dashboard");
      }
    }
    catch (error) {
      if (error.response && error.response.data && error.response.data.message) {
        setError(error.response.data.message);
      } else {
        setError("Unexpected Error. Please try again");
      }
    }
  }

  const handleGoogleLogin = async (response) => {
    try {
      const res = await axiosInstance.post("/auth/google", {
        token: response.credential,
      });

      if (res.data && res.data.accessToken) {
        localStorage.setItem("token", res.data.accessToken);
        navigate("/dashboard");
      }
    } catch (err) {
      console.error("Google login failed", err);
      setError("Google login failed");
    }
  };

  useEffect(() => {
    if (window.google) {
      window.google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: handleGoogleLogin,
      });

      window.google.accounts.id.renderButton(
        document.getElementById("google-login-btn"),
        { theme: "outline", size: "large" }
      );
    }
  }, []);

  return (<>
    <Navbar />
    <div className='flex items-center justify-center mt-30'>
      <div className='border rounded bg-white w-96 px-7 py-10'>
        <form onSubmit={handleSignUp}>
          <h4 className='text-2xl mb-7'>Sign Up</h4>
          <input
            className='input-box'
            type='text'
            placeholder='Name'
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className='input-box'
            type='email'
            placeholder='Email'
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <PasswordInput
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          {error && <p className='text-red-500 text-xs pb-1'>{error}</p>}

          <button className='btn-primary' type='submit'>Create Account</button>

          <p className='text-sm text-center mt-4'>
            Already have an account?{" "}
            <Link to='/login' className='text-primary font-medium underline'>Log in</Link>
          </p>
          <div className="mt-5 flex justify-center" id="google-login-btn"></div>
        </form>
      </div>
    </div>
  </>);
};

export default SignUp
