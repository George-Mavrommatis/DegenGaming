import React, { useState, useEffect, useCallback } from "react";
import { FaUserPlus, FaUserCheck, FaUserTimes, FaTrash, FaSyncAlt } from "react-icons/fa";
import { useProfile } from "../context/ProfileContext";
import { db } from "../firebase/firebaseConfig";
import { doc, getDoc, updateDoc, arrayUnion, arrayRemove } from "firebase/firestore";
import { searchUsers } from "../firebase/userSearch";
import { ensureUserHasArrays } from "../firebase/userProfile";
import {
  sendDuelInvite,
  proposeDuelTime,
  agreeDuelTime,
  cancelDuelInvitation,
} from "../utilities/duelInvitations";
import { ProfileData } from "../types/profile"; // Import ProfileData

type PendingType = "incoming" | "outgoing";
type FullPending = {
  id: string;
  username: string;
  wallet: string;
  avatarUrl?: string;
  __pendingType: PendingType;
};
type Tab = "friends" | "pending";

interface FriendsPanelProps {
  onSelectChat: (user: ProfileData) => void; // Explicitly define type as ProfileData
  onSendDuel?: (user: ProfileData) => void;
}

const sectionCard =
  "rounded-xl bg-gray-800/80 shadow-md p-5 mb-4 border border-gray-700";

export default function FriendsPanel({
  onSelectChat,
  onSendDuel,
}: FriendsPanelProps) {
  const { user, profile, refreshProfile } = useProfile();

  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<ProfileData[]>([]); // Explicitly type searchResults
  const [isSearching, setIsSearching] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [friends, setFriends] = useState<ProfileData[]>([]); // Explicitly type friends
  const [pendingList, setPendingList] = useState<FullPending[]>([]);
  const [tab, setTab] = useState<Tab>("friends");

  const [loading, setLoading] = useState(true);

  const loadAll = useCallback(async () => {
    setLoading(true);

    if (!profile || !user) {
        setFriends([]);
        setPendingList([]);
        setLoading(false);
        return;
    }
    
    const currentFriends = profile.friends || [];
    const currentFriendRequests = profile.friendRequests || [];
    const currentSentInvitations = profile.sentInvitations || [];

    try {
      if (currentFriends.length > 0) {
        const docs = await Promise.all(
          currentFriends.map((fid: string) => getDoc(doc(db, "users", fid)))
        );
        setFriends(
          docs
            .filter((d) => d.exists())
            .map((d) => ({ id: d.id, ...d.data() as ProfileData })) // Cast to ProfileData
        );
      } else {
        setFriends([]);
      }
    } catch (err) {
      console.error("Error loading friends:", err);
      setError("Failed to load friends data.");
      setFriends([]);
    }

    let merged: FullPending[] = [];
    try {
      if (currentFriendRequests.length > 0) {
        const docsIncoming = await Promise.all(
          currentFriendRequests.map((fid: string) => getDoc(doc(db, "users", fid)))
        );
        merged = merged.concat(
          docsIncoming
            .filter((d) => d.exists())
            .map((d) => ({
              id: d.id,
              username: d.data()?.username || "",
              wallet: d.data()?.wallet || "",
              avatarUrl: d.data()?.avatarUrl,
              __pendingType: "incoming" as const,
            }))
        );
      }
      if (currentSentInvitations.length > 0) {
        const docsOutgoing = await Promise.all(
          currentSentInvitations.map((fid: string) => getDoc(doc(db, "users", fid)))
        );
        merged = merged.concat(
          docsOutgoing
            .filter((d) => d.exists())
            .map((d) => ({
              id: d.id,
              username: d.data()?.username || "",
              wallet: d.data()?.wallet || "",
              avatarUrl: d.data()?.avatarUrl,
              __pendingType: "outgoing" as const,
            }))
        );
      }
      const seen = new Set<string>();
      setPendingList(
        merged.filter((x) => {
          const key = `${x.id}_${x.__pendingType}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
      );
    } catch (err) {
      console.error("Error loading pending requests:", err);
      setError("Failed to load pending requests data.");
      setPendingList([]);
    } finally {
        setLoading(false);
    }
  }, [user, profile]); 

  useEffect(() => {
    loadAll();
  }, [user, profile, loadAll]); 

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearching(true);
    setError("");
    setSuccess("");
    if (!searchTerm.trim()) {
        setError("Please enter a username or wallet address.");
        setIsSearching(false);
        return;
    }
    if (!user) {
        setError("You must be logged in to search for users.");
        setIsSearching(false);
        return;
    }

    try {
      const isWallet = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(searchTerm.trim());
      const matches = await searchUsers({
        username: isWallet ? undefined : searchTerm.trim(),
        wallet: isWallet ? searchTerm.trim() : undefined,
      });
      setSearchResults((matches || []).filter((u: any) => u.id && u.id !== user.uid));
    } catch (e: any) {
      setError("Search failed: " + (e?.message || "Unknown error"));
    }
    setIsSearching(false);
  };

  const showSuccess = (msg: string) => {
    setSuccess(msg);
    setTimeout(() => setSuccess(""), 2500);
  };
  const showError = (msg: string) => {
    setError(msg);
    setTimeout(() => setError(""), 5000);
  };

  const sendFriendRequest = async (targetUserId: string) => {
    if (!user) return showError("Not logged in!");
    if (!profile) return showError("Profile not loaded yet!");
    if (!targetUserId) return showError("No user selected!");
    if (targetUserId === user.uid) return showError("You cannot friend yourself!");

    const currentFriends = profile.friends || [];
    const currentSentInvitations = profile.sentInvitations || [];
    const currentFriendRequests = profile.friendRequests || [];

    if (currentFriends.includes(targetUserId)) {
        return showError("Already friends with this user.");
    }
    if (currentSentInvitations.includes(targetUserId)) {
        return showError("Friend request already sent to this user.");
    }
    if (currentFriendRequests.includes(targetUserId)) {
        return showError("This user has already sent you a friend request. Please accept it from the Pending tab.");
    }

    try {
      await ensureUserHasArrays(user.uid);
      await ensureUserHasArrays(targetUserId);

      await updateDoc(doc(db, "users", targetUserId), {
        friendRequests: arrayUnion(user.uid),
      });
      await updateDoc(doc(db, "users", user.uid), {
        sentInvitations: arrayUnion(targetUserId),
      });
      showError("");
      setSearchTerm("");
      setSearchResults([]);
      showSuccess("Friend request sent!");
      await refreshProfile?.(); 
      await loadAll();
    } catch (e: any) {
      showError("Failed to send request: " + (e?.message || "Unknown error"));
    }
  };

  const acceptFriendRequest = async (fromUserId: string) => {
    if (!user) return showError("Not logged in!");
    if (!profile) return showError("Profile not loaded yet!");
    if (!fromUserId) return showError("Invalid incoming request!");
    try {
      await ensureUserHasArrays(user.uid);
      await ensureUserHasArrays(fromUserId);
      await updateDoc(doc(db, "users", user.uid), {
        friendRequests: arrayRemove(fromUserId),
        friends: arrayUnion(fromUserId),
      });
      await updateDoc(doc(db, "users", fromUserId), {
        friends: arrayUnion(user.uid),
        sentInvitations: arrayRemove(user.uid),
      });
      showSuccess("Friend request accepted.");
      await refreshProfile?.();
      await loadAll();
    } catch (e) {
      showError("Failed to accept request");
    }
  };

  const declineFriendRequest = async (fromUserId: string) => {
    if (!user) return showError("Not logged in!");
    if (!profile) return showError("Profile not loaded yet!");
    if (!fromUserId) return showError("Invalid incoming request!");
    try {
      await ensureUserHasArrays(user.uid);
      await ensureUserHasArrays(fromUserId);
      await updateDoc(doc(db, "users", user.uid), {
        friendRequests: arrayRemove(fromUserId),
      });
      await updateDoc(doc(db, "users", fromUserId), {
        sentInvitations: arrayRemove(user.uid),
      });
      showSuccess("Friend request declined.");
      await refreshProfile?.();
      await loadAll();
    } catch (e) {
      showError("Failed to decline request");
    }
  };

  const cancelSentInvitation = async (toUserId: string) => {
    if (!user) return showError("Not logged in!");
    if (!profile) return showError("Profile not loaded yet!");
    if (!toUserId) return showError("No invitation found!");
    try {
      await ensureUserHasArrays(user.uid);
      await ensureUserHasArrays(toUserId);
      await updateDoc(doc(db, "users", user.uid), {
        sentInvitations: arrayRemove(toUserId),
      });
      await updateDoc(doc(db, "users", toUserId), {
        friendRequests: arrayRemove(user.uid),
      });
      showSuccess("Invitation cancelled.");
      await refreshProfile?.();
      await loadAll();
    } catch (e) {
      showError("Failed to cancel invitation");
    }
  };

  const removeFriend = async (friendId: string) => {
    if (!user) return showError("Not logged in!");
    if (!profile) return showError("Profile not loaded yet!");
    if (!friendId) return showError("Invalid friend!");
    try {
      await ensureUserHasArrays(user.uid);
      await ensureUserHasArrays(friendId);
      await updateDoc(doc(db, "users", user.uid), {
        friends: arrayRemove(friendId),
      });
      await updateDoc(doc(db, "users", friendId), {
        friends: arrayRemove(user.uid),
      });
      showSuccess("Friend removed.");
      await refreshProfile?.();
      await loadAll();
    } catch (e) {
      showError("Failed to remove friend");
    }
  };

  return (
    <div className="h-full flex flex-col px-4 py-5 min-h-0">
      {/* Search/Add User */}
      <form onSubmit={onSearch} className={`${sectionCard} flex flex-col gap-3`}>
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Search by username or wallet address"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setError("");
              setSuccess("");
            }}
            className="w-full bg-gray-900 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-purple-500 transition"
          />
          <button
            type="submit"
            disabled={isSearching || !profile || !user}
            className="bg-purple-600 hover:bg-purple-700 active:bg-purple-800 transition px-4 py-2 rounded-lg flex items-center gap-2 font-bold text-white shadow disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <FaUserPlus /> Add
          </button>
          <button
            type="button"
            onClick={async () => {
              if (user) {
                showError("");
                showSuccess("");
                await refreshProfile?.();
                await loadAll();
              } else {
                showError("Please log in to refresh friend data.");
              }
            }}
            title="Refresh friends"
            disabled={!user || !profile}
            className="bg-gray-700 hover:bg-gray-600 ml-2 px-3 py-2 rounded-lg flex items-center text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <FaSyncAlt />
          </button>
        </div>
        {error && <div className="text-xs text-red-400 mt-1">{error}</div>}
        {success && <div className="text-xs text-green-400 mt-1">{success}</div>}
      </form>

      {searchResults.length > 0 && (
        <div className={`${sectionCard}`}>
          <div className="font-semibold mb-2 text-purple-300">Search Results</div>
          {searchResults.map((r, i) => (
            <div
              key={r.id || r.wallet || i}
              className="flex gap-4 items-center border-b border-gray-700 last:border-b-0 py-2"
            >
              <img
                src={r.avatarUrl || "/WegenRaceAssets/G1small.png"}
                className="w-10 h-10 rounded-full object-cover bg-gray-700"
                alt=""
                onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
              />
              <div className="flex-1">
                <div className="font-bold text-white">{r.username}</div>
                <div className="text-xs text-gray-400 break-all">{r.wallet}</div>
              </div>
              <button
                disabled={!r.id}
                className="ml-auto bg-purple-700 hover:bg-purple-800 px-3 py-1 rounded text-xs font-semibold text-white shadow disabled:opacity-50"
                onClick={() => r.id && sendFriendRequest(r.id)}
              >
                Send Invite
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 mb-4 mt-2">
        <button
          className={`flex-1 rounded-lg py-2 font-bold transition ${
            tab === "friends"
              ? "bg-purple-700 text-white shadow"
              : "bg-gray-700 text-purple-200 hover:bg-purple-900/60"
          }`}
          onClick={() => setTab("friends")}
        >
          Friends
        </button>
        <button
          className={`flex-1 rounded-lg py-2 font-bold transition ${
            tab === "pending"
              ? "bg-purple-700 text-white shadow"
              : "bg-gray-700 text-purple-200 hover:bg-purple-900/60"
          }`}
          onClick={() => setTab("pending")}
        >
          Pending ({pendingList.length})
        </button>
      </div>

      {/* Friends List */}
      {tab === "friends" && (
        <div className={sectionCard + " flex-1 min-h-0 overflow-y-auto"}>
          {loading || !user ? (
            <div className="text-gray-400 text-center py-4">
              {loading ? "Loading friends..." : "Please log in to see your friends."}
            </div>
          ) : friends.length === 0 ? (
            <div className="text-gray-400 text-center py-4">No friends yet. Add some to start chatting or dueling!</div>
          ) : (
            friends.map((friend: ProfileData) => { // Explicitly type 'friend'
              const duelWithFriend = (profile?.duelInvitations || []).find(
                (inv: any) =>
                  (inv.from === friend.id || inv.to === friend.id) &&
                  inv.status !== "cancelled"
              );
              return (
                <div
                  key={friend.id || friend.wallet}
                  className="flex items-center gap-4 border-b border-gray-700 last:border-b-0 py-2 group"
                >
                  <img
                    src={friend.avatarUrl || "/WegenRaceAssets/G1small.png"}
                    className="w-10 h-10 rounded-full object-cover bg-gray-700"
                    alt=""
                    onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }}
                  />
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => onSelectChat(friend)} // Pass the full ProfileData
                  >
                    <div className="font-bold text-white group-hover:underline">
                      {friend.username}
                    </div>
                    <div className="text-xs text-gray-400 break-all">
                      {friend.wallet}
                    </div>
                  </div>
                  <button
                    className="bg-blue-700 hover:bg-blue-800 px-2 py-1 rounded text-xs font-semibold text-white shadow"
                    onClick={() => {
                        console.log("FriendsPanel: Clicking chat for:", friend);
                        console.log("Current user UID (myUid):", user?.uid);
                        console.log("Target user UID (targetUid):", friend.id);
                        onSelectChat(friend); // Pass the full ProfileData
                    }}
                    title="Chat"
                  >
                    💬
                  </button>
                  <button
                    className="bg-yellow-700 hover:bg-yellow-800 px-2 py-1 rounded text-xs font-semibold text-white shadow disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={() =>
                      onSendDuel ? onSendDuel(friend) : sendDuelInvite(user, friend)
                    }
                    title="Duel"
                    disabled={!!duelWithFriend || !user?.uid || !(profile?.duelsOpen ?? true)}
                  >
                    ⚔️ Duel
                  </button>
                  <button
                    className="bg-red-700 hover:bg-red-800 px-2 py-1 rounded text-xs font-semibold text-white shadow"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFriend(friend.id);
                    }}
                    title="Remove Friend"
                  >
                    <FaTrash />
                  </button>
                  {duelWithFriend && (
                    <div className="ml-3 flex flex-col text-xs bg-gray-900 p-2 rounded w-48">
                      <b className="text-purple-300">Duel:</b>{" "}
                      {duelWithFriend.status === "pending" && (
                         <span className="text-gray-400">Waiting for response</span>
                      )}
                      {/* --- BEGIN CORRECTION AREA --- */}
                      {duelWithFriend.status === "proposed" && (
                        <> {/* Use a React Fragment to wrap multiple elements */}
                          <span className="text-gray-400">Time:</span>{" "}
                          <b className="text-white">{duelWithFriend.suggestedTime}</b>
                          {duelWithFriend.lastActionBy !== user?.uid && (
                            <div className="mt-2">
                              <button
                                className="px-2 py-1 bg-green-700 text-white rounded text-xs hover:bg-green-600 mr-1"
                                onClick={async () => {
                                  if (user?.uid) await agreeDuelTime(
                                    user.uid,
                                    duelWithFriend.invitationId,
                                    user.uid
                                  );
                                }}
                              >
                                Agree
                              </button>
                              <button
                                className="px-2 py-1 bg-red-700 text-white rounded text-xs hover:bg-red-600"
                                onClick={async () => {
                                  if (user?.uid) await cancelDuelInvitation(
                                    user.uid,
                                    duelWithFriend.invitationId
                                  );
                                }}
                              >
                                Decline
                              </button>
                            </div>
                          )}
                        </>
                      )}
                      {duelWithFriend.status === "agreed" && (
                        <> {/* Use a React Fragment to wrap multiple elements */}
                          <span className="text-gray-400">Agreed! Time:</span>{" "}
                          <b className="text-white">{duelWithFriend.agreedTime}</b>
                          <span className="block mt-1 text-green-400">
                            Room will be created soon.
                          </span>
                        </>
                      )}
                      {/* --- END CORRECTION AREA --- */}
                      {duelWithFriend.status === "pending" &&
                        duelWithFriend.lastActionBy !== user?.uid && (
                          <form
                            onSubmit={async (e) => {
                              e.preventDefault();
                              const time = (e.target as any).elements.time.value;
                              if (user?.uid) await proposeDuelTime(
                                user.uid,
                                duelWithFriend.invitationId,
                                time,
                                user.uid
                              );
                            }}
                            className="mt-2 flex flex-col"
                          >
                            <input
                              type="datetime-local"
                              name="time"
                              className="bg-gray-800 text-white px-1 py-1 mb-1 rounded text-xs"
                              required
                            />
                            <button
                              className="bg-purple-700 px-2 py-1 rounded text-white text-xs hover:bg-purple-600"
                              type="submit"
                            >
                              Propose Time
                            </button>
                          </form>
                        )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* Merged Pending */}
      {tab === "pending" && (
        <div className={sectionCard + " flex-1 min-h-0 overflow-y-auto"}>
          {loading || !user ? (
            <div className="text-gray-400 text-center py-4">
              {loading ? "Loading pending requests..." : "Please log in to see pending requests."}
            </div>
          ) : pendingList.length === 0 ? (
            <div className="text-gray-400 text-center py-4">No pending friend requests or invitations.</div>
          ) : (
            pendingList.map((u, i) => (
              <div key={u.id + u.__pendingType} className="flex items-center gap-4 border-b border-gray-700 last:border-b-0 py-2">
                <img src={u.avatarUrl || "/WegenRaceAssets/G1small.png"}
                     className="w-10 h-10 rounded-full object-cover bg-gray-700"
                     alt=""
                     onError={(e) => { e.currentTarget.src = '/WegenRaceAssets/G1small.png'; }} />
                <div className="flex-1">
                  <div className="font-bold text-white">{u.username}</div>
                  <div className="text-xs text-gray-400 break-all">{u.wallet}</div>
                  <div className="text-xs text-yellow-300 mt-1">
                    {u.__pendingType === "incoming" ? "Incoming request" : "Sent invitation"}
                  </div>
                </div>
                {u.__pendingType === "incoming" ? (
                  <>
                    <button
                      className="bg-green-700 hover:bg-green-800 px-3 py-1 rounded text-xs font-semibold text-white shadow"
                      onClick={() => acceptFriendRequest(u.id)}
                    >
                      <FaUserCheck /> Accept
                    </button>
                    <button
                      className="bg-red-700 hover:bg-red-800 ml-2 px-3 py-1 rounded text-xs font-semibold text-white shadow"
                      onClick={() => declineFriendRequest(u.id)}
                    >
                      <FaUserTimes /> Decline
                    </button>
                  </>
                ) : (
                  <button
                    className="bg-red-700 hover:bg-red-800 px-3 py-1 rounded text-xs font-semibold text-white shadow"
                    onClick={() => cancelSentInvitation(u.id)}
                  >
                    <FaUserTimes /> Cancel
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}