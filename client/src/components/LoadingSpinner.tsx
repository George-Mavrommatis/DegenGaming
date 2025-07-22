// client/src/components/LoadingSpinner.tsx

import React from 'react';
import { Player } from '@lottiefiles/react-lottie-player';
// REMOVE this line: import animationData from '../../public/assets/images/lottie/loading-spinner.json';

// Correct way to reference an asset in the public folder for its URL
// The path here is relative to the `public` folder itself
const lottieAnimationUrl = '/assets/images/lottie/loading-spinner.json'; // Note the leading slash and correct path from `public`

const LoadingSpinner: React.FC = () => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%' }}>
      <Player
        autoplay
        loop
        src={lottieAnimationUrl} // Pass the URL here
        style={{ height: '100px', width: '100px' }} // Adjust size as needed
      />
    </div>
  );
};

export default LoadingSpinner;