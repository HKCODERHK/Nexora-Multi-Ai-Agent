import { getAuth } from "firebase-admin/auth"
import { app } from "../config/firebase.js"
import User from "../models/user.model.js"
import mongoose from "mongoose"
import redis from "../../../shared/redis/redis.js"

const SESSION_TTL = 7 * 24 * 60 * 60

// Rewrite the cached session so the UI sees the new plan/credits.
// Skips users who are not logged in (no session id), instead of writing "session-null".
const refreshSession = async (user) => {
    const sessionId = await redis.get(`user-session-${user._id}`)
    if (!sessionId) return
    await redis.set(`session-${sessionId}`, JSON.stringify({
        userId: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        plan: user.plan,
        credits: user.credits,
        totalCredits: user.totalCredits,
        planExpiresAt: user.planExpiresAt
    }), "EX", SESSION_TTL)
}

export const login = async (req, res) => {
    try {
        const { token } = req.body
        const decoded = await getAuth(app).verifyIdToken(token)
        let user = await User.findOne({
            firebaseUid: decoded.uid
        })

        if (!user) {
            user = await User.create({
                firebaseUid: decoded.uid,
                name: decoded.name,
                email: decoded.email,
                avatar: decoded.picture
            })
        }

        const sessionId = crypto.randomUUID()
        await redis.set(`user-session-${user?._id}`,
            sessionId
            , "EX", 7 * 24 * 60 * 60)
        await redis.set(`session-${sessionId}`, JSON.stringify({
            userId: user._id,
            name: user.name,
            email: user.email,
            avatar: user.avatar,
            plan: user.plan,
            credits: user.credits,
            totalCredits: user.totalCredits,
            planExpiresAt: user.planExpiresAt
        }), "EX", 7 * 24 * 60 * 60)




        res.cookie("session", sessionId, {
            httpOnly: true,
            secure: false,
            sameSite: "strict",
            maxAge: 7 * 24 * 60 * 60 * 1000
        })

        return res.status(200).json(user)

    } catch (error) {
        return res.status(500).json({ message: `login error ${error}` })
    }
}


export const logOut = async (req, res) => {
    try {
        const sessionId = req.cookies?.session
        await redis.del(`session-${sessionId}`)

        res.clearCookie("session")
        return res.status(200).json({ message: "logout successfully" })
    } catch (error) {
        return res.status(500).json({ message: `logout error ${error}` })
    }
}


export const updateUserPayment = async (req, res) => {
    try {
        const { plan, credits, userId } = req.body
        if (!mongoose.isValidObjectId(userId)) {
            return res.status(404).json({ message: "User not found" })
        }
        // $inc instead of read-add-save: a credit deduction running at the same
        // moment can no longer be overwritten by a stale balance.
        const user = await User.findByIdAndUpdate(
            userId,
            {
                $set: { plan, planExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
                $inc: { credits, totalCredits: credits }
            },
            { returnDocument: "after" }
        )
        if (!user) {
            return res.status(404).json({ message: "User not found" })
        }

        await refreshSession(user)

        return res.status(200).json({ success: true })

    } catch (error) {
        return res.status(500).json({ message: `update user payment error ${error}` })
    }
}


// Cost in credits per agent call; anything not listed costs 1.
export const COST = {
    chat: 1,
    search: 5,
    coding: 10,
    pdf: 10,
    ppt: 10,
    vision: 10
}

export const deductCredits = async (req, res) => {
    try {
        const { userId, agent } = req.body
        const requiredCredits = COST[agent] || 1

        if (!mongoose.isValidObjectId(userId)) {
            return res.status(404).json({ message: "user not found" })
        }

        // One atomic operation: the check (credits >= cost) and the decrement happen
        // together inside MongoDB, so two parallel requests can never both pass the
        // check and push the balance below zero.
        const user = await User.findOneAndUpdate(
            { _id: userId, credits: { $gte: requiredCredits } },
            { $inc: { credits: -requiredCredits } },
            { returnDocument: "after" }
        )

        if (!user) {
            const exists = await User.exists({ _id: userId })
            if (!exists) {
                return res.status(404).json({ message: "user not found" })
            }
            return res.status(400).json({ message: "Not enough credits." })
        }

        await refreshSession(user)

        return res.status(200).json({ success: true, credits: user.credits })
    } catch (error) {
        return res.status(500).json({ message: `deduct credits error ${error}` })
    }
}
