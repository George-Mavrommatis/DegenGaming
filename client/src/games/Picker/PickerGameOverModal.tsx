// src/games/Picker/PickerGameOverModal.tsx  
import React, { useEffect, useState } from 'react';  
import Modal from 'react-modal';  
import { Player as LottiePlayer } from '@lottiefiles/react-lottie-player';  

// Generic Player interface that works with all games  
// In PickerGameOverModal.tsx  
interface Player {  
    key: string;  
    username: string;  
    name?: string; // Alias for username  
    wallet?: string;  
    avatarUrl?: string;  
    isHumanPlayer?: boolean;  
    isGuest?: boolean;  
    // Make these optional as they might not always be present  
    finalProgress?: number;  
    finishTime?: number;  
    progress?: number;  
}  
// Dynamic Modal Styles based on screen size  
const useModalStyles = () => {  
    const [modalStyles, setModalStyles] = useState({  
        overlay: {  
            backgroundColor: "rgba(10, 10, 20, 0.95)",  
            zIndex: 10000,  
            display: "flex",  
            alignItems: "center",  
            justifyContent: "center",  
            padding: "10px"  
        },  
        content: {  
            position: "static" as const,  
            maxWidth: "95vw",  
            width: "100%",  
            maxHeight: "95vh",  
            height: "auto",  
            border: "none",  
            borderRadius: "1.2em",  
            background: "none",  
            padding: 0,  
            overflow: "hidden"  
        }  
    });  

    useEffect(() => {  
        const updateModalStyles = () => {  
            const screenHeight = window.innerHeight;  
            const screenWidth = window.innerWidth;  

            setModalStyles({  
                overlay: {  
                    backgroundColor: "rgba(10, 10, 20, 0.95)",  
                    zIndex: 10000,  
                    display: "flex",  
                    alignItems: "center",  
                    justifyContent: "center",  
                    padding: screenHeight < 700 ? "5px" : "10px"  
                },  
                content: {  
                    position: "static" as const,  
                    maxWidth: screenWidth < 640 ? "98vw" : screenWidth < 1024 ? "90vw" : "85vw",  
                    width: "100%",  
                    maxHeight: screenHeight < 700 ? "98vh" : "95vh",  
                    height: "auto",  
                    border: "none",  
                    borderRadius: screenWidth < 640 ? "0.8em" : "1.2em",  
                    background: "none",  
                    padding: 0,  
                    overflow: "hidden"  
                }  
            });  
        };  

        updateModalStyles();  
        window.addEventListener('resize', updateModalStyles);  
        return () => window.removeEventListener('resize', updateModalStyles);  
    }, []);  

    return modalStyles;  
};  

interface Props {  
    isOpen: boolean;  
    onClose: () => void;  
    results?: Player[]; // For other games  
    winner?: Player;  
    rankings?: Player[];  
    humanPlayerChoice?: Player;  
    gameType?: string;  
    gameTitle?: string;  
    onPlayAgain?: () => void;  
    onBackToGames?: () => void;  
}  

const PickerGameOverModal: React.FC<Props> = ({  
    isOpen,  
    onClose,  
    results,  
    winner,  
    rankings,  
    humanPlayerChoice,  
    gameType,  
    gameTitle,  
    onPlayAgain,  
    onBackToGames  
}) => {  
    const modalStyles = useModalStyles();  
    const [screenSize, setScreenSize] = useState({  
        width: window.innerWidth,  
        height: window.innerHeight  
    });  

    useEffect(() => {  
        const handleResize = () => {  
            setScreenSize({  
                width: window.innerWidth,  
                height: window.innerHeight  
            });  
        };  

        window.addEventListener('resize', handleResize);  
        return () => window.removeEventListener('resize', handleResize);  
    }, []);  

    if (!isOpen) {  
        return null;  
    }  

    const finalResults = rankings || results || [];  
    const gameWinner = winner || (finalResults.length > 0 ? finalResults[0] : null);  
    const podiumPlayers = finalResults.slice(0, 3);  

    const isMobile = screenSize.width < 640;  
    const isTablet = screenSize.width >= 640 && screenSize.width < 1024;  
    const isSmallHeight = screenSize.height < 700;  
    
    const maxResultsHeight = isSmallHeight ? '25vh' : isMobile ? '35vh' : '40vh';  
    const containerPadding = isMobile ? 'p-3' : isTablet ? 'p-4' : 'p-6';  
    const textSizes = {  
        title: isMobile ? 'text-2xl' : isTablet ? 'text-3xl' : 'text-4xl',  
        subtitle: isMobile ? 'text-lg' : isTablet ? 'text-xl' : 'text-2xl',  
        body: isMobile ? 'text-sm' : 'text-base',  
        small: isMobile ? 'text-xs' : 'text-sm'  
    };  

    const getDisplayName = (player: Player): string => {  
        if (!player) return 'Unknown';  
        const name = player.username || player.name; // Use username or name property  
        if (name && name.trim() !== '' && !name.startsWith('0x') && !name.includes('...')) {  
            return name;  
        }  
        const walletAddress = player.wallet || player.username;  
        if (walletAddress && typeof walletAddress === 'string') {  
            if (walletAddress.length > 10) {  
                return `${walletAddress.slice(0, 4)}...${walletAddress.slice(-3)}`;  
            }  
            return walletAddress;  
        }  
        if (player.isGuest) {  
            return 'Guest Player';  
        }  
        return 'Unknown Player';  
    };  

    const getProgress = (player: Player): number => {  
        return player.finalProgress || player.progress || 0;  
    };  

    if (finalResults.length === 0) {  
        return (  
            <Modal  
                isOpen={isOpen}  
                onRequestClose={onClose}  
                ariaHideApp={false}  
                style={modalStyles}  
                contentLabel="Game Over Modal"  
                shouldCloseOnOverlayClick={false}  
            >  
                <div className={`w-full mx-auto ${containerPadding} rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl flex flex-col items-center relative border-2 border-red-500`}>  
                    <h2 className={`${textSizes.subtitle} font-bold text-red-400 mb-4`}>No Results Available</h2>  
                    <button  
                        className="py-2 px-4 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold"  
                        onClick={onClose}  
                    >  
                        Close  
                    </button>  
                </div>  
            </Modal>  
        );  
    }  

    return (  
        <Modal  
            isOpen={isOpen}  
            onRequestClose={onClose}  
            ariaHideApp={false}  
            style={modalStyles}  
            contentLabel="Game Over Modal"  
            shouldCloseOnOverlayClick={false}  
        >  
            <div className={`w-full h-full max-h-[95vh] overflow-hidden rounded-2xl bg-gradient-to-br from-zinc-900 via-zinc-800 to-black shadow-2xl border-2 border-yellow-500 flex flex-col`}>  
                
                <div className="flex-1 overflow-y-auto">  
                    <div className={`${containerPadding} flex flex-col items-center relative`}>  
                        
                        {!isMobile && (  
                            <LottiePlayer  
                                src="/assets/lottie/confetti.json"  
                                autoplay  
                                loop={false}  
                                style={{  
                                    width: '100%',  
                                    height: '100%',  
                                    position: 'absolute',  
                                    top: 0,  
                                    left: 0,  
                                    zIndex: 1,  
                                    pointerEvents: 'none'  
                                }}  
                            />  
                        )}  
                        
                        <div className="relative z-10 w-full flex flex-col items-center space-y-4">  
                            <h2 className={`${textSizes.title} font-extrabold text-yellow-300 text-center font-orbitron`}>  
                                {gameType === 'wegen-race' ? '🦒 Race Complete! 🏁' : '🏁 Game Over! 🏁'}  
                            </h2>  
                            
                            {gameWinner && (  
                                <div className="w-full flex flex-col items-center bg-gradient-to-r from-yellow-600/20 to-yellow-400/20 p-3 rounded-lg border-2 border-yellow-400 shadow-lg">  
                                    <div className={`text-yellow-200 ${textSizes.body} font-bold mb-2`}>🏆 CHAMPION 🏆</div>  
                                    <div className="flex items-center gap-3">  
                                        <img  
                                            src={gameWinner.avatarUrl || '/WegenRaceAssets/G1small.png'}  
                                            alt="winner"  
                                            className={`rounded-full border-4 border-yellow-300 shadow-lg ${  
                                                isMobile ? 'w-12 h-12' : 'w-16 h-16'  
                                            }`}  
                                        />  
                                        <div className="text-center">  
                                            <div className={`${textSizes.subtitle} font-bold text-white truncate max-w-[200px]`}>  
                                                {getDisplayName(gameWinner)}  
                                            </div>  
                                            <div className={`${textSizes.small} text-yellow-300`}>  
                                                Final Score: {Math.round(getProgress(gameWinner))}%  
                                            </div>  
                                            {gameWinner.finishTime && (  
                                                <div className={`${textSizes.small} text-yellow-300`}>  
                                                    Time: {gameWinner.finishTime.toFixed(2)}s  
                                                </div>  
                                            )}  
                                        </div>  
                                    </div>  
                                </div>  
                            )}  

                            {humanPlayerChoice && gameType === 'wegen-race' && (  
                                <div className="w-full p-3 rounded-lg border-2 border-blue-400 bg-blue-900/20">  
                                    <div className="text-center">  
                                        <div className={`text-blue-300 font-bold mb-1 ${textSizes.body}`}>👤 Your Pick Results</div>  
                                        <div className={`text-white ${textSizes.small}`}>  
                                            You chose: <span className="text-yellow-300 font-bold">{getDisplayName(humanPlayerChoice)}</span>  
                                        </div>  
                                        {gameWinner && gameWinner.key === humanPlayerChoice.key ? (  
                                            <div className={`text-green-400 font-bold mt-2 animate-pulse ${isMobile ? 'text-base' : 'text-lg'}`}>  
                                                🎉 CONGRATULATIONS! YOUR PICK WON! 🎉  
                                            </div>  
                                        ) : (  
                                            <div className={`text-orange-400 mt-2 ${textSizes.small}`}>  
                                                😢 Better luck next time! Your pick finished #{finalResults.findIndex(p => p.key === humanPlayerChoice.key) + 1}  
                                            </div>  
                                        )}  
                                    </div>  
                                </div>  
                            )}  

                            {podiumPlayers.length >= 3 && (  
                                <div className="w-full p-3 bg-gradient-to-r from-gray-800/50 to-gray-700/50 rounded-lg border border-gray-600">  
                                    <h3 className={`${textSizes.body} font-bold text-center text-gray-200 mb-3`}>🥇 Podium 🥇</h3>  
                                    <div className="flex justify-center items-end gap-2">  
                                        <div className="flex flex-col items-center">  
                                            <div className={`${isMobile ? 'text-lg' : 'text-2xl'} mb-1`}>🥈</div>  
                                            <img  
                                                src={podiumPlayers[1].avatarUrl || '/WegenRaceAssets/G1small.png'}  
                                                alt="2nd place"  
                                                className={`rounded-full border-2 border-gray-400 mb-1 ${  
                                                    isMobile ? 'w-8 h-8' : 'w-12 h-12'  
                                                }`}  
                                            />  
                                            <div className={`${textSizes.small} text-center text-gray-300 max-w-16 truncate`}>  
                                                {getDisplayName(podiumPlayers[1])}  
                                            </div>  
                                            <div className="text-xs text-gray-400">  
                                                {Math.round(getProgress(podiumPlayers[1]))}%  
                                            </div>  
                                        </div>  
                                        
                                        <div className="flex flex-col items-center">  
                                            <div className={`${isMobile ? 'text-2xl' : 'text-3xl'} mb-1`}>🥇</div>  
                                            <img  
                                                src={podiumPlayers[0].avatarUrl || '/WegenRaceAssets/G1small.png'}  
                                                alt="1st place"  
                                                className={`rounded-full border-4 border-yellow-400 mb-1 ${  
                                                    isMobile ? 'w-12 h-12' : 'w-16 h-16'  
                                                }`}  
                                            />  
                                            <div className={`${textSizes.small} text-center text-yellow-300 font-bold max-w-20 truncate`}>  
                                                {getDisplayName(podiumPlayers[0])}  
                                            </div>  
                                            <div className="text-xs text-yellow-400">  
                                                {Math.round(getProgress(podiumPlayers[0]))}%  
                                            </div>  
                                        </div>  
                                        
                                        <div className="flex flex-col items-center">  
                                            <div className={`${isMobile ? 'text-lg' : 'text-2xl'} mb-1`}>🥉</div>  
                                            <img  
                                                src={podiumPlayers[2].avatarUrl || '/WegenRaceAssets/G1small.png'}  
                                                alt="3rd place"  
                                                className={`rounded-full border-2 border-orange-600 mb-1 ${  
                                                    isMobile ? 'w-8 h-8' : 'w-12 h-12'  
                                                }`}  
                                            />  
                                            <div className={`${textSizes.small} text-center text-gray-300 max-w-16 truncate`}>  
                                                {getDisplayName(podiumPlayers[2])}  
                                            </div>  
                                            <div className="text-xs text-gray-400">  
                                                {Math.round(getProgress(podiumPlayers[2]))}%  
                                            </div>  
                                        </div>  
                                    </div>  
                                </div>  
                            )}  

                            <div className="w-full bg-gray-800/50 rounded-lg border border-gray-600 flex flex-col">  
                                <h3 className={`${textSizes.body} font-bold text-center text-gray-200 p-3 border-b border-gray-600`}>  
                                    📊 Full Results  
                                </h3>  
                                <div  
                                    className="overflow-y-auto pr-2 p-3"  
                                    style={{  
                                        maxHeight: maxResultsHeight,  
                                        minHeight: isMobile ? '150px' : '200px'  
                                    }}  
                                >  
                                    <div className="space-y-2">  
                                        {finalResults.map((player, index) => {  
                                            const position = index + 1;  
                                            const isWinner = index === 0;  
                                            const isPodium = index < 3;  
                                            const isHumanPick = humanPlayerChoice && player.key === humanPlayerChoice.key;  

                                            return (  
                                                <div  
                                                    key={player.key || index}  
                                                    className={`  
                                                        flex items-center gap-2 p-2 rounded-lg transition-all  
                                                        ${isWinner  
                                                            ? 'bg-gradient-to-r from-yellow-600/30 to-yellow-400/30 border-2 border-yellow-400'  
                                                            : isPodium  
                                                                ? 'bg-gradient-to-r from-gray-600/30 to-gray-500/30 border border-gray-400'  
                                                                : isHumanPick  
                                                                    ? 'bg-gradient-to-r from-blue-600/30 to-blue-500/30 border border-blue-400'  
                                                                    : 'bg-gray-700/50 border border-gray-600'  
                                                        }  
                                                    `}  
                                                >  
                                                    <div className="flex items-center gap-1">  
                                                        <div className={`font-bold w-6 text-center text-yellow-300 ${textSizes.small}`}>  
                                                            {position}  
                                                        </div>  
                                                        {position === 1 && <span className="text-sm">🏆</span>}  
                                                        {position === 2 && <span className="text-sm">🥈</span>}  
                                                        {position === 3 && <span className="text-sm">🥉</span>}  
                                                        {isHumanPick && <span className="text-sm">👤</span>}  
                                                    </div>  
                                                    
                                                    <img  
                                                        src={player.avatarUrl || '/WegenRaceAssets/G1small.png'}  
                                                        alt={getDisplayName(player)}  
                                                        className={`rounded-full border-2 border-gray-500 ${  
                                                            isMobile ? 'w-8 h-8' : 'w-10 h-10'  
                                                        }`}  
                                                    />  
                                                    
                                                    <div className="flex-grow min-w-0">  
                                                        <div className={`text-white font-semibold truncate ${textSizes.small}`}>  
                                                            {getDisplayName(player)}  
                                                        </div>  
                                                        <div className="text-xs text-gray-400">  
                                                            Progress: {Math.round(getProgress(player))}%  
                                                        </div>  
                                                    </div>  
                                                    
                                                    <div className={`font-mono text-gray-400 text-right ${textSizes.small}`}>  
                                                        {player.finishTime ? `${player.finishTime.toFixed(2)}s` : `${Math.round(getProgress(player))}%`}  
                                                    </div>  
                                                </div>  
                                            );  
                                        })}  
                                    </div>  
                                </div>  
                            </div>  

                            <div className="w-full bg-blue-900/20 p-3 rounded-lg border border-blue-500">  
                                <h4 className={`${textSizes.small} font-bold text-blue-300 mb-2 text-center`}>📈 Race Statistics</h4>  
                                <div className={`grid ${isMobile ? 'grid-cols-2' : 'grid-cols-4'} gap-2 text-xs`}>  
                                    <div className="text-center">  
                                        <div className="text-gray-400">Total Players</div>  
                                        <div className="text-white font-bold">{finalResults.length}</div>  
                                    </div>  
                                    <div className="text-center">  
                                        <div className="text-gray-400">Finished</div>  
                                        <div className="text-white font-bold">
                                            {finalResults.filter(p => getProgress(p) >= 100).length}
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-gray-400">Best Score</div>
                                        <div className="text-white font-bold">
                                            {Math.round(Math.max(...finalResults.map(p => getProgress(p))))}%
                                        </div>
                                    </div>
                                    <div className="text-center">
                                        <div className="text-gray-400">Average</div>
                                        <div className="text-white font-bold">
                                            {Math.round(finalResults.reduce((sum, p) => sum + getProgress(p), 0) / finalResults.length)}%
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`flex-shrink-0 border-t border-gray-600 bg-black/50 ${containerPadding}`}>
                    <div className="w-full space-y-3">
                        {onPlayAgain && (
                            <button
                                className={`w-full py-3 rounded-lg bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-bold shadow-lg hover:scale-105 transition-all ${textSizes.body}`}
                                onClick={onPlayAgain}
                            >
                                {gameType === 'wegen-race' ? '🦒 Race Again' : '🎮 Play Again'}
                            </button>
                        )}
                        
                        <div className="grid grid-cols-2 gap-3">
                            <button
                                className={`py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white font-bold shadow transition-all ${textSizes.small}`}
                                onClick={onClose}
                            >
                                Close
                            </button>
                            
                            {onBackToGames && (
                                <button
                                    className={`py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-bold shadow transition-all ${textSizes.small}`}
                                    onClick={onBackToGames}
                                >
                                    All Games
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default PickerGameOverModal;