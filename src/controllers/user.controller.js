import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js"
import { User } from "../models/user.modal.js";
import { uploadOnCloudinary } from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken";
import { deleteLocalFile } from "../utils/deleteLocalFile.js";

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) throw new ApiError(404, "User not found")
        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };

    } catch (error) {
        throw new ApiError(500, "Error in generating tokens")
    }
}

const registerUser = asyncHandler(async (req, res) => {

    const { fullname, email, username, password } = req.body

    if ([fullname, email, username, password].some((field) =>
        field?.trim() === "")) {
        throw new ApiError(400, "All fields are required")
    }

    const existingUser = await User.findOne({
        $or: [{ email }, { username }]
    })
    if (existingUser) {
        throw new ApiError(409, "User already exists")
    }
    // console.log('req', req);

    const avatarLocalPath = req.files?.avatar[0]?.path;
    let coverImageLocalPath;

    if (req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length > 0) {
        coverImageLocalPath = req.files?.coverImage[0]?.path;

    }

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar is required")
    }
    // upload on cloudinary
    const avatar = await uploadOnCloudinary(avatarLocalPath)
    const coverImage = await uploadOnCloudinary(coverImageLocalPath)

    const user = await User.create({
        fullname,
        email,
        username: username.toLowerCase(),
        password,
        avatar: avatar?.url,
        coverImage: coverImage?.url || "",
    })

    const createdUser = await User.findById(user._id).select("-password -refreshToken")

    if (!createdUser) {
        throw new ApiError(500, "Something Went Wrong User registration failed")
    }
    return res.status(201).json(new ApiResponse(200, createdUser, "User registered successfully"))


})

const loginUser = asyncHandler(async (req, res) => {
    const { email, username, password } = req.body

    if (!email && !username) {
        throw new ApiError(400, "Username or Email is required to login");
    }

    const query = email
        ? { email }
        : { username: username.toLowerCase() };

    const user = await User.findOne(query);
    if (!user) {
        throw new ApiError(404, "User not found")
    }
    const isPasswordValid = await user.isPasswordCorrect(password)

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials")
    }
    const { accessToken, refreshToken } = await generateAccessAndRefreshTokens(user._id)
    const loggedInUser = await User.findById(user._id).select("-password -refreshToken")

    const options = {
        httpOnly: true,
        secure: true,
    }

    return res
        .status(200)
        .cookie("refreshToken", refreshToken, options)
        .cookie("accessToken", accessToken, options)
        .json(
            (new ApiResponse(200, { user: loggedInUser, accessToken, refreshToken }, "User logged in successfully"))
        )
}
)

const logoutUser = asyncHandler(async (req, res) => {

    await User.findByIdAndUpdate(req.user._id, {
        $set: {
            refreshToken: undefined
        }
    },
        {
            new: true
        }
    )

    const options = {
        httpOnly: true,
        secure: true,
    }
    return res
        .status(200)
        .clearCookie("refreshToken", options)
        .clearCookie("accessToken", options)
        .json(new ApiResponse(200, {}, "User logged out successfully"))
}
)

const refreshAccessToken = asyncHandler(async (req, res) => {
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if (!incomingRefreshToken) {
        throw new ApiError(401, "unauthorized! No token provided")
    }

    try {
        const decodedToken = jwt.verify(incomingRefreshToken, process.env.REFRESH_TOKEN_SECRET)

        const user = await User.findById(decodedToken?._id)
        if (!user || user?.refreshToken !== incomingRefreshToken) {
            throw new ApiError(401, "Invalid refresh token")
        }

        const options = {
            httpOnly: true,
            secure: true,
        }

        const { accessToken, newRefreshToken } = await generateAccessAndRefreshTokens(user._id)

        return res
            .status(200)
            .cookie("refreshToken", newRefreshToken, options)
            .cookie("accessToken", accessToken, options)
            .json(
                (new ApiResponse(200, { accessToken, newRefreshToken }, "Access token refreshed successfully"))
            )
    } catch (error) {
        throw new ApiError(401, error.message || "Unauthorized! Invalid token")
    }
})

const changeCurrentPassword = asyncHandler(async (req, res) => {
    const { oldPassword, newPassword } = req.body

    if ([oldPassword, newPassword].some((field) => field?.trim() === "")) {
        throw new ApiError(400, "All fields are required")
    }

    if (oldPassword === newPassword) {
        throw new ApiError(400, "New password must be different from old password")
    }

    const user = await User.findById(req.user._id)
    if (!user) {
        throw new ApiError(404, "User not found")
    }

    const isPasswordValid = await user.isPasswordCorrect(oldPassword)

    if (!isPasswordValid) {
        throw new ApiError(401, "Invalid user credentials")
    }

    user.password = newPassword
    await user.save({ validateBeforeSave: false })

    return res.status(200).json(new ApiResponse(200, {}, "Password changed successfully"))
})

const getCUrrentUser = asyncHandler(async (req, res) => {
    return res.status(200).json(new ApiResponse(200, req.user, "current user fetched successfully"))
})

const updateAccountDetails = asyncHandler(async (req, res) => {
    const { fullname, email } = req.body;
    if (!fullname || !email) {
        throw new ApiError(400, "fullname and email are required")
    }
    const user = User.findByIdAndUpdate(req.user._id,
        {
            $set: {
                fullname,
                email
            }
        },
        { new: true }).select('-password')

    return res.status(200).json(
        new ApiResponse(200, user, "Account details updated successfully")
    )
})

const updateUserAvatar = asyncHandler(async (req, res) => {
    const avatarLocalPath = req.file?.path;

    if (!avatarLocalPath) {
        throw new ApiError(400, "Avatar image is required");
    }

    let avatar;
    try {
        avatar = await uploadOnCloudinary(avatarLocalPath);
    } catch (err) {
        deleteLocalFile(avatarLocalPath); // cleanup if upload fails
        throw new ApiError(500, "Error in uploading avatar image");
    }

    deleteLocalFile(avatarLocalPath); // cleanup after upload

    if (!avatar?.url) {
        throw new ApiError(500, "Error in uploading avatar image");
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { avatar: avatar.url } },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(new ApiResponse(200, user, "User avatar updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
    const coverImageLocalPath = req.file?.path;

    if (!coverImageLocalPath) {
        throw new ApiError(400, "Cover image is required");
    }

    let coverImage;
    try {
        coverImage = await uploadOnCloudinary(coverImageLocalPath);
    } catch (err) {
        deleteLocalFile(coverImageLocalPath); // cleanup even if upload fails
        throw new ApiError(500, "Error in uploading cover image");
    }

    deleteLocalFile(coverImageLocalPath); // cleanup after upload

    if (!coverImage?.url) {
        throw new ApiError(500, "Error in uploading cover image");
    }

    const user = await User.findByIdAndUpdate(
        req.user._id,
        { $set: { coverImage: coverImage.url } },
        { new: true }
    ).select("-password -refreshToken");

    return res
        .status(200)
        .json(new ApiResponse(200, user, "User cover image updated successfully"));
});

const getUserChannelProfile = asyncHandler(async (req, res) => {
    const { username } = req.params;
    if (!username?.trim()) {
        throw new ApiError(400, "Username is required");
    }
    const channel = await User.aggregate([
        {
            $match: { username: username?.toLowerCase() }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "channel",
                as: "subscribers"
            }
        },
        {
            $lookup: {
                from: "subscriptions",
                localField: "_id",
                foreignField: "subscriber",
                as: "subscribedTo"
            }
        },
        {
            $addFields: {
                subscribersCount: {
                    $size: "$subscribers"
                },
                channelsSubscribedToCOunt: {
                    $size: "$subscribedTo"
                },
                isSubscribed: {
                    $cond: {
                        if: {
                            $in: [req.user?._id, "$subscribers.subscriber"],
                            then: true,
                            else: false
                        }
                    }
                }

            }
        },
        {
            $project: {
                fullname: 1,
                username: 1,
                email: 1,
                avatar: 1,
                coverImage: 1,
                subscribersCount: 1,
                channelsSubscribedToCOunt: 1,
                isSubscribed: 1,
                createdAt: 1,
                updatedAt: 1
            }
        }
    ])

    if (!channel || channel.length === 0) {
        throw new ApiError(404, "Channel not found")
    }
    return res.status(200).json(new ApiResponse(200, channel[0], "Channel profile fetched successfully"))
})

export { registerUser, loginUser, logoutUser, refreshAccessToken, changeCurrentPassword, getCUrrentUser, updateAccountDetails, updateUserAvatar, updateUserCoverImage, getUserChannelProfile };