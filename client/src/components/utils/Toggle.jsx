import React from "react";
import "./toggle.css";

const Toggle = ({ checked, onChange, children }) => {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={onChange} />
      <div className="slider"></div>
      <div className="content">{children}</div>
    </label>
  );
};

export default Toggle;
