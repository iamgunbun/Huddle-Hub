import React from 'react';
import ProjectionsPanel from '../components/Projections/ProjectionsPanel';

export default function Projections() {
    return (
        <div style={{ padding: '40px', color: '#f8fafc' }}>
            <h1 style={{ color: '#eebf1c', textTransform: 'uppercase' }}>Matchup Projections</h1>
            <ProjectionsPanel />
        </div>
    );
}