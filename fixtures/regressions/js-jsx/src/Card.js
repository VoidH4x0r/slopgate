import React from 'react';

// A perfectly ordinary React component in a .js file (no JSX in .jsx needed).
export function Card({ title }) {
  return (
    <div className="card">
      <h2>{title}</h2>
    </div>
  );
}

export function stubHandler() {}

export function notImplemented() {
  throw new Error("not implemented");
}
